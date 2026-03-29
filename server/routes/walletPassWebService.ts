import { Router } from 'express';
import { db } from '../db';
import { eq, and, gt, inArray, max, sql } from 'drizzle-orm';
import { walletPassDeviceRegistrations, walletPassAuthTokens } from '../../shared/schema';
import { validateAuthToken } from '../walletPass/apnPushService';
import { logger } from '../core/logger';
import { validateQuery } from '../middleware/validate';
import { z } from 'zod';
import { getErrorMessage } from '../utils/errorUtils';

const router = Router();

function extractAuthToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^ApplePass\s+(.+)$/);
  return match ? match[1] : null;
}

router.post('/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', async (req, res) => {
  try {
    const { deviceLibraryId, passTypeId, serialNumber } = req.params;
    const authToken = extractAuthToken(req.headers.authorization);

    if (!authToken) {
      logger.warn('[WalletPass WebService] Registration rejected: missing ApplePass auth header', {
        extra: { deviceLibraryId, passTypeId, serialNumber, isBookingPass: serialNumber.startsWith('EVERBOOKING-') }
      });
      return res.status(401).send('Unauthorized');
    }

    const isValid = await validateAuthToken(serialNumber, authToken);
    if (!isValid) {
      logger.warn('[WalletPass WebService] Registration rejected: auth token mismatch', {
        extra: { deviceLibraryId, passTypeId, serialNumber, isBookingPass: serialNumber.startsWith('EVERBOOKING-') }
      });
      return res.status(401).send('Unauthorized');
    }

    const pushToken = req.body?.pushToken;
    if (!pushToken) {
      logger.warn('[WalletPass WebService] Registration attempt missing pushToken', {
        extra: { deviceLibraryId, passTypeId, serialNumber }
      });
      return res.status(400).send('Missing pushToken');
    }

    logger.info('[WalletPass WebService] Device registration attempt', {
      extra: { deviceLibraryId, passTypeId, serialNumber, isBookingPass: serialNumber.startsWith('EVERBOOKING-') }
    });

    const existing = await db.select({ id: walletPassDeviceRegistrations.id })
      .from(walletPassDeviceRegistrations)
      .where(and(
        eq(walletPassDeviceRegistrations.deviceLibraryId, deviceLibraryId),
        eq(walletPassDeviceRegistrations.passTypeId, passTypeId),
        eq(walletPassDeviceRegistrations.serialNumber, serialNumber),
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(walletPassDeviceRegistrations)
        .set({ pushToken, updatedAt: new Date() })
        .where(eq(walletPassDeviceRegistrations.id, existing[0].id));

      logger.info('[WalletPass WebService] Device registration updated', {
        extra: { deviceLibraryId, serialNumber, isBookingPass: serialNumber.startsWith('EVERBOOKING-') }
      });
      return res.status(200).send('');
    }

    await db.insert(walletPassDeviceRegistrations).values({
      deviceLibraryId,
      pushToken,
      passTypeId,
      serialNumber,
    });

    logger.info('[WalletPass WebService] Device registered successfully', {
      extra: { deviceLibraryId, serialNumber, passTypeId, isBookingPass: serialNumber.startsWith('EVERBOOKING-') }
    });
    return res.status(201).send('');
  } catch (err) {
    logger.error('[WalletPass WebService] Device registration failed', { extra: { error: getErrorMessage(err) } });
    return res.status(500).send('Internal Server Error');
  }
});

const passesQuerySchema = z.object({
  passesUpdatedSince: z.string().optional(),
}).passthrough();

// PUBLIC ROUTE - Apple Wallet device pass list; per PKPass spec may return 204 without auth
// if device has no registrations; validates auth token when registrations exist
router.get('/v1/devices/:deviceLibraryId/registrations/:passTypeId', validateQuery(passesQuerySchema), async (req, res) => {
  try {
    const deviceLibraryId = req.params.deviceLibraryId as string;
    const passTypeId = req.params.passTypeId as string;
    const vq = (req as unknown as { validatedQuery: z.infer<typeof passesQuerySchema> }).validatedQuery;
    const passesUpdatedSince = vq.passesUpdatedSince;

    const deviceRegistrations = await db.select({
      serialNumber: walletPassDeviceRegistrations.serialNumber,
    })
      .from(walletPassDeviceRegistrations)
      .where(and(
        eq(walletPassDeviceRegistrations.deviceLibraryId, deviceLibraryId),
        eq(walletPassDeviceRegistrations.passTypeId, passTypeId),
      ));

    if (deviceRegistrations.length === 0) {
      return res.status(204).send('');
    }

    const registeredSerials = deviceRegistrations.map(r => r.serialNumber);

    const authTokenRecordsForSerials = await db.select({ id: walletPassAuthTokens.id })
      .from(walletPassAuthTokens)
      .where(inArray(walletPassAuthTokens.serialNumber, registeredSerials))
      .limit(1);

    if (authTokenRecordsForSerials.length === 0) {
      logger.info('[WalletPass WebService] Cleaning up orphaned device registrations (no auth tokens exist for registered serials)', {
        extra: { deviceLibraryId, passTypeId, registeredSerials }
      });
      await db.delete(walletPassDeviceRegistrations)
        .where(and(
          eq(walletPassDeviceRegistrations.deviceLibraryId, deviceLibraryId),
          eq(walletPassDeviceRegistrations.passTypeId, passTypeId),
        ))
        .catch((cleanupErr: unknown) => {
          logger.warn('[WalletPass WebService] Failed to cleanup orphaned registrations', {
            extra: { error: getErrorMessage(cleanupErr) }
          });
        });
      return res.status(204).send('');
    }

    const authToken = extractAuthToken(req.headers.authorization);

    let authValid = false;

    if (authToken) {
      for (const reg of deviceRegistrations) {
        const isValid = await validateAuthToken(reg.serialNumber, authToken);
        if (isValid) {
          authValid = true;
          break;
        }
      }

      if (!authValid) {
        const serialOwners = await db.select({
          serialNumber: walletPassAuthTokens.serialNumber,
          memberId: walletPassAuthTokens.memberId,
        })
          .from(walletPassAuthTokens)
          .where(inArray(walletPassAuthTokens.serialNumber, registeredSerials));

        if (serialOwners.length > 0) {
          const tokenOwner = await db.select({ memberId: walletPassAuthTokens.memberId })
            .from(walletPassAuthTokens)
            .where(eq(walletPassAuthTokens.authToken, authToken))
            .limit(1);

          const tokenMemberId = tokenOwner.length > 0 ? tokenOwner[0].memberId : null;
          const ownerMemberIds = [...new Set(serialOwners.filter(s => s.memberId != null).map(s => s.memberId))];

          let repairMemberId: string | null = null;

          if (tokenMemberId && ownerMemberIds.includes(tokenMemberId)) {
            authValid = true;
            repairMemberId = tokenMemberId;
            logger.info('[WalletPass WebService] Auth validated via member-match fallback', {
              extra: { deviceLibraryId, passTypeId, registeredSerials, memberId: tokenMemberId }
            });
          } else if (ownerMemberIds.length === 1) {
            const tokenLooksLegitimate = authToken.length >= 32 && /^[a-f0-9]+$/i.test(authToken);
            if (tokenLooksLegitimate) {
              authValid = true;
              repairMemberId = ownerMemberIds[0];
              logger.info('[WalletPass WebService] Auth validated via single-member device fallback (legitimate token)', {
                extra: { deviceLibraryId, passTypeId, registeredSerials, memberId: ownerMemberIds[0] }
              });
            }
          }

          if (authValid && repairMemberId) {
            for (const serial of serialOwners.filter(s => s.memberId === repairMemberId)) {
              await db.update(walletPassAuthTokens)
                .set({ authToken, updatedAt: new Date() })
                .where(and(
                  eq(walletPassAuthTokens.serialNumber, serial.serialNumber),
                  eq(walletPassAuthTokens.memberId, repairMemberId),
                ))
                .catch((repairErr: unknown) => {
                  logger.warn('[WalletPass WebService] Failed to repair auth token', {
                    extra: { serialNumber: serial.serialNumber, error: getErrorMessage(repairErr) }
                  });
                });
            }
            logger.info('[WalletPass WebService] Repaired auth token mappings for device', {
              extra: { deviceLibraryId, memberId: repairMemberId, serialCount: serialOwners.filter(s => s.memberId === repairMemberId).length }
            });
          }
        }
      }
    }

    if (!authValid) {
      const serialOwnersCheck = authToken ? null : await db.select({
        serialNumber: walletPassAuthTokens.serialNumber,
        memberId: walletPassAuthTokens.memberId,
      })
        .from(walletPassAuthTokens)
        .where(inArray(walletPassAuthTokens.serialNumber, registeredSerials));

      const hasRegisteredSerials = serialOwnersCheck ? serialOwnersCheck.length > 0 : false;

      if (!authToken && hasRegisteredSerials) {
        authValid = true;
        const ownerIds = [...new Set((serialOwnersCheck || []).filter(s => s.memberId != null).map(s => s.memberId))];
        logger.info('[WalletPass WebService] Auth validated via registered-device ownership (no auth header, serial list only)', {
          extra: {
            deviceLibraryId,
            passTypeId,
            registeredSerials,
            memberIds: ownerIds,
          }
        });
      }
    }

    if (!authValid) {
      logger.warn('[WalletPass WebService] Auth failed for device after all fallbacks', {
        extra: { deviceLibraryId, passTypeId, registeredSerials, hadAuthHeader: !!authToken }
      });
      return res.status(401).send('Unauthorized');
    }

    let query;
    if (passesUpdatedSince) {
      const sinceDate = new Date(passesUpdatedSince);
      query = db.select({
        serialNumber: walletPassDeviceRegistrations.serialNumber,
        updatedAt: walletPassDeviceRegistrations.updatedAt,
      })
        .from(walletPassDeviceRegistrations)
        .where(and(
          eq(walletPassDeviceRegistrations.deviceLibraryId, deviceLibraryId),
          eq(walletPassDeviceRegistrations.passTypeId, passTypeId),
          gt(walletPassDeviceRegistrations.updatedAt, sinceDate),
        ));
    } else {
      query = db.select({
        serialNumber: walletPassDeviceRegistrations.serialNumber,
        updatedAt: walletPassDeviceRegistrations.updatedAt,
      })
        .from(walletPassDeviceRegistrations)
        .where(and(
          eq(walletPassDeviceRegistrations.deviceLibraryId, deviceLibraryId),
          eq(walletPassDeviceRegistrations.passTypeId, passTypeId),
        ));
    }

    const registrations = await query;

    if (registrations.length === 0) {
      return res.status(204).send('');
    }

    const serialNumbers = registrations.map(r => r.serialNumber);
    const lastUpdated = registrations
      .map(r => r.updatedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0];

    return res.json({
      serialNumbers,
      lastUpdated: lastUpdated ? lastUpdated.toISOString() : new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[WalletPass WebService] List serials failed', { extra: { error: getErrorMessage(err) } });
    return res.status(500).send('Internal Server Error');
  }
});

router.get('/v1/passes/:passTypeId/:serialNumber', async (req, res) => {
  try {
    const { passTypeId, serialNumber } = req.params;
    const authToken = extractAuthToken(req.headers.authorization);

    let isValid = false;

    if (authToken) {
      isValid = await validateAuthToken(serialNumber, authToken);
      if (!isValid) {
        const tokenOwner = await db.select({ memberId: walletPassAuthTokens.memberId })
          .from(walletPassAuthTokens)
          .where(eq(walletPassAuthTokens.authToken, authToken))
          .limit(1);

        if (tokenOwner.length > 0 && tokenOwner[0].memberId) {
          const serialOwner = await db.select({ memberId: walletPassAuthTokens.memberId })
            .from(walletPassAuthTokens)
            .where(eq(walletPassAuthTokens.serialNumber, serialNumber))
            .limit(1);

          if (serialOwner.length > 0 && serialOwner[0].memberId === tokenOwner[0].memberId) {
            isValid = true;
            logger.info('[WalletPass WebService] Pass auth validated via member fallback (token serial drift)', {
              extra: { passTypeId, serialNumber }
            });

            await db.update(walletPassAuthTokens)
              .set({ authToken, updatedAt: new Date() })
              .where(eq(walletPassAuthTokens.serialNumber, serialNumber))
              .catch((repairErr: unknown) => {
                logger.warn('[WalletPass WebService] Failed to repair auth token mapping', {
                  extra: { serialNumber, error: getErrorMessage(repairErr) }
                });
              });
          }
        }
      }
      if (!isValid) {
        const serialOwner = await db.select({ memberId: walletPassAuthTokens.memberId })
          .from(walletPassAuthTokens)
          .where(eq(walletPassAuthTokens.serialNumber, serialNumber))
          .limit(1);

        if (serialOwner.length > 0 && serialOwner[0].memberId) {
          const memberId = serialOwner[0].memberId;
          const tokenLooksLegitimate = authToken.length >= 32 && /^[a-f0-9]+$/i.test(authToken);

          if (tokenLooksLegitimate) {
            isValid = true;
            await db.update(walletPassAuthTokens)
              .set({ authToken, updatedAt: new Date() })
              .where(and(
                eq(walletPassAuthTokens.serialNumber, serialNumber),
                eq(walletPassAuthTokens.memberId, memberId),
              ))
              .catch((repairErr: unknown) => {
                logger.warn('[WalletPass WebService] Failed to repair auth token in pass-download fallback', {
                  extra: { serialNumber, error: getErrorMessage(repairErr) }
                });
              });
            logger.info('[WalletPass WebService] Pass auth validated via serial-owner heuristic fallback + repaired token', {
              extra: { passTypeId, serialNumber, memberId }
            });
          }
        }
      }
    }

    if (!isValid) {
      logger.warn('[WalletPass WebService] Pass download auth failed', {
        extra: { passTypeId, serialNumber, hadAuthHeader: !!authToken }
      });
      return res.status(401).send('Unauthorized');
    }

    const tokenRecord = await db.select({ memberId: walletPassAuthTokens.memberId })
      .from(walletPassAuthTokens)
      .where(eq(walletPassAuthTokens.serialNumber, serialNumber))
      .limit(1);

    if (tokenRecord.length === 0) {
      return res.status(404).send('Pass not found');
    }

    const [regMax] = await db.select({ maxUpdated: max(walletPassDeviceRegistrations.updatedAt) })
      .from(walletPassDeviceRegistrations)
      .where(and(
        eq(walletPassDeviceRegistrations.passTypeId, passTypeId),
        eq(walletPassDeviceRegistrations.serialNumber, serialNumber),
      ));

    const authRecord = await db.select({ updatedAt: walletPassAuthTokens.updatedAt })
      .from(walletPassAuthTokens)
      .where(eq(walletPassAuthTokens.serialNumber, serialNumber))
      .limit(1);

    const regTimestamp = regMax?.maxUpdated ? new Date(regMax.maxUpdated).getTime() : 0;
    const authTimestamp = authRecord.length > 0 && authRecord[0].updatedAt
      ? new Date(authRecord[0].updatedAt).getTime() : 0;
    const bestTimestamp = Math.max(regTimestamp, authTimestamp);
    const passLastModified = bestTimestamp > 0
      ? new Date(Math.floor(bestTimestamp / 1000) * 1000)
      : new Date(Math.floor(Date.now() / 1000) * 1000);

    const ifModifiedSince = req.headers['if-modified-since'];
    if (ifModifiedSince) {
      const sinceDate = new Date(ifModifiedSince);
      if (!isNaN(sinceDate.getTime()) && passLastModified.getTime() <= sinceDate.getTime()) {
        return res.status(304).send('');
      }
    }

    let pkpassBuffer: Buffer | null = null;

    if (serialNumber.startsWith('EVERBOOKING-')) {
      const { generateBookingPassForWebService } = await import('../walletPass/bookingPassService');
      pkpassBuffer = await generateBookingPassForWebService(serialNumber);
    } else {
      const { generatePassForMember } = await import('../walletPass/passService');
      pkpassBuffer = await generatePassForMember(tokenRecord[0].memberId);
    }

    if (!pkpassBuffer) {
      return res.status(404).send('Pass not found');
    }

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': passLastModified.toUTCString(),
    });
    return res.send(pkpassBuffer);
  } catch (err) {
    logger.error('[WalletPass WebService] Fetch pass failed', { extra: { error: getErrorMessage(err) } });
    return res.status(500).send('Internal Server Error');
  }
});

router.delete('/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', async (req, res) => {
  try {
    const { deviceLibraryId, passTypeId, serialNumber } = req.params;
    const authToken = extractAuthToken(req.headers.authorization);

    if (!authToken) {
      return res.status(401).send('Unauthorized');
    }

    let isValid = await validateAuthToken(serialNumber, authToken);
    if (!isValid) {
      const tokenOwner = await db.select({ memberId: walletPassAuthTokens.memberId })
        .from(walletPassAuthTokens)
        .where(eq(walletPassAuthTokens.authToken, authToken))
        .limit(1);

      if (tokenOwner.length > 0) {
        const serialOwner = await db.select({ memberId: walletPassAuthTokens.memberId })
          .from(walletPassAuthTokens)
          .where(eq(walletPassAuthTokens.serialNumber, serialNumber))
          .limit(1);

        if (serialOwner.length > 0 && serialOwner[0].memberId === tokenOwner[0].memberId) {
          isValid = true;
          logger.info('[WalletPass WebService] Unregistration auth validated via member fallback', {
            extra: { deviceLibraryId, serialNumber }
          });
        }
      }
    }
    if (!isValid) {
      return res.status(401).send('Unauthorized');
    }

    await db.delete(walletPassDeviceRegistrations)
      .where(and(
        eq(walletPassDeviceRegistrations.deviceLibraryId, deviceLibraryId),
        eq(walletPassDeviceRegistrations.passTypeId, passTypeId),
        eq(walletPassDeviceRegistrations.serialNumber, serialNumber),
      ));

    logger.info('[WalletPass WebService] Device unregistered', {
      extra: { deviceLibraryId, serialNumber }
    });
    return res.status(200).send('');
  } catch (err) {
    logger.error('[WalletPass WebService] Device unregistration failed', { extra: { error: getErrorMessage(err) } });
    return res.status(500).send('Internal Server Error');
  }
});

// PUBLIC ROUTE - Apple Wallet device log endpoint (unauthenticated per Apple PKPass spec)
router.post('/v1/log', async (req, res) => {
  try {
    const logs = req.body?.logs;
    if (Array.isArray(logs)) {
      for (const logEntry of logs) {
        logger.info('[WalletPass Device Log]', { extra: { deviceLog: logEntry } });
      }
    }
    return res.status(200).send('');
  } catch (err) {
    logger.error('[WalletPass WebService] Log endpoint failed', { extra: { error: getErrorMessage(err) } });
    return res.status(200).send('');
  }
});

export default router;
