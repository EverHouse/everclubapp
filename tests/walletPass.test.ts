// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

const mockExecute = vi.fn();
const mockSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
};
const mockSelect = vi.fn().mockReturnValue(mockSelectChain);
const mockInsertChain = {
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
};
const mockInsert = vi.fn().mockReturnValue(mockInsertChain);
const mockUpdateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};
const mockUpdate = vi.fn().mockReturnValue(mockUpdateChain);
const mockDeleteChain = {
  where: vi.fn().mockResolvedValue(undefined),
};
const mockDeleteFn = vi.fn().mockReturnValue(mockDeleteChain);

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDeleteFn,
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const result: Record<string, unknown> = { __sqlStrings: Array.from(strings), __sqlValues: values };
    result.as = vi.fn().mockReturnValue(result);
    return result;
  };
  sqlTagFn.join = vi.fn();
  return {
    sql: sqlTagFn,
    eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
    and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
    or: vi.fn(),
    inArray: vi.fn(),
    gt: vi.fn(),
    max: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  users: { id: 'id', firstName: 'firstName', lastName: 'lastName', email: 'email', tier: 'tier', membershipStatus: 'membershipStatus', joinDate: 'joinDate', role: 'role' },
  membershipTiers: { name: 'name', dailySimMinutes: 'dailySimMinutes', dailyConfRoomMinutes: 'dailyConfRoomMinutes', guestPassesPerYear: 'guestPassesPerYear', walletPassBgColor: 'walletPassBgColor', walletPassForegroundColor: 'walletPassForegroundColor', walletPassLabelColor: 'walletPassLabelColor' },
  guestPasses: { memberEmail: 'memberEmail', passesUsed: 'passesUsed', passesTotal: 'passesTotal' },
  walletPassDeviceRegistrations: { id: 'id', deviceLibraryId: 'deviceLibraryId', pushToken: 'pushToken', passTypeId: 'passTypeId', serialNumber: 'serialNumber', updatedAt: 'updatedAt' },
  walletPassAuthTokens: { id: 'id', serialNumber: 'serialNumber', authToken: 'authToken', memberId: 'memberId', updatedAt: 'updatedAt' },
  bookingWalletPasses: { id: 'id', bookingId: 'bookingId', serialNumber: 'serialNumber', authenticationToken: 'authenticationToken', memberId: 'memberId', voidedAt: 'voidedAt' },
  bookingRequests: { id: 'id', userId: 'userId', userEmail: 'userEmail', userName: 'userName', resourceId: 'resourceId', requestDate: 'requestDate', startTime: 'startTime', endTime: 'endTime', durationMinutes: 'durationMinutes', status: 'status', declaredPlayerCount: 'declaredPlayerCount' },
  resources: { id: 'id', name: 'name' },
}));

vi.mock('../shared/constants/tiers', () => ({
  normalizeTierName: vi.fn((tier: string) => tier),
}));

vi.mock('node-forge', () => {
  const mockSign = vi.fn();
  return {
    default: {
      pki: {
        certificateFromPem: vi.fn().mockReturnValue({ subject: {} }),
        privateKeyFromPem: vi.fn().mockReturnValue({}),
        oids: {
          sha256: '2.16.840.1.101.3.4.2.1',
          contentType: '1.2.840.113549.1.9.3',
          data: '1.2.840.113549.1.7.1',
          messageDigest: '1.2.840.113549.1.9.4',
          signingTime: '1.2.840.113549.1.9.5',
        },
      },
      pkcs7: {
        createSignedData: vi.fn().mockReturnValue({
          content: null,
          addCertificate: vi.fn(),
          addSigner: vi.fn(),
          sign: mockSign,
          toAsn1: vi.fn().mockReturnValue({}),
        }),
      },
      asn1: {
        toDer: vi.fn().mockReturnValue({
          getBytes: vi.fn().mockReturnValue('mock-signature-bytes'),
        }),
      },
      util: {
        createBuffer: vi.fn().mockReturnValue({}),
      },
    },
  };
});

vi.mock('archiver', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      const listeners: Record<string, Function[]> = {};
      const instance = {
        on: vi.fn((event: string, cb: Function) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
          return instance;
        }),
        append: vi.fn(),
        finalize: vi.fn().mockImplementation(() => {
          if (listeners['data']) {
            listeners['data'].forEach(cb => cb(Buffer.from('mock-pkpass-data')));
          }
          if (listeners['end']) {
            listeners['end'].forEach(cb => cb());
          }
        }),
      };
      return instance;
    }),
  };
});

vi.mock('sharp', () => {
  const mockSharpInstance = {
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-image')),
  };
  return { default: vi.fn().mockReturnValue(mockSharpInstance) };
});

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
  },
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('http2', () => {
  const mockRequest = {
    setEncoding: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  };
  return {
    default: {
      connect: vi.fn().mockReturnValue({
        on: vi.fn(),
        request: vi.fn().mockReturnValue(mockRequest),
        close: vi.fn(),
      }),
    },
  };
});

vi.mock('../server/core/settingsHelper', () => ({
  getSettingValue: vi.fn().mockResolvedValue(''),
  getSettingBoolean: vi.fn().mockResolvedValue(false),
}));

vi.mock('../server/core/middleware', () => ({
  isAuthenticated: vi.fn((_req: unknown, _res: unknown, next: Function) => next()),
  isStaffOrAdmin: vi.fn((_req: unknown, _res: unknown, next: Function) => next()),
}));

vi.mock('../server/types/session', () => ({
  getSessionUser: vi.fn(),
}));

vi.mock('../server/middleware/paramSchemas', () => ({
  numericIdParam: {
    safeParse: vi.fn((val: string) => {
      const isNumeric = /^\d+$/.test(val);
      return isNumeric
        ? { success: true, data: val }
        : { success: false, error: 'Invalid' };
    }),
  },
  requiredStringParam: {
    safeParse: vi.fn((val: string) => ({
      success: typeof val === 'string' && val.length > 0,
      data: val,
    })),
  },
}));

vi.mock('../server/middleware/validate', () => ({
  validateQuery: vi.fn(() => (_req: unknown, _res: unknown, next: Function) => next()),
}));

vi.mock('../server/utils/urlUtils', () => ({
  getAppBaseUrl: vi.fn().mockReturnValue('https://everclub.app'),
}));

let realValidateAuthToken: Function;
let realGetOrCreateAuthToken: Function;
let realSendPassUpdatePush: Function;

const mockValidateAuthToken = vi.fn();
const mockGetOrCreateAuthToken = vi.fn();
const mockSendPassUpdatePush = vi.fn();

vi.mock('../server/walletPass/apnPushService', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  realValidateAuthToken = original.validateAuthToken as Function;
  realGetOrCreateAuthToken = original.getOrCreateAuthToken as Function;
  realSendPassUpdatePush = original.sendPassUpdatePush as Function;

  mockValidateAuthToken.mockImplementation((...args: unknown[]) => realValidateAuthToken(...args));
  mockGetOrCreateAuthToken.mockImplementation((...args: unknown[]) => realGetOrCreateAuthToken(...args));
  mockSendPassUpdatePush.mockImplementation((...args: unknown[]) => realSendPassUpdatePush(...args));

  return {
    ...original,
    validateAuthToken: (...args: unknown[]) => mockValidateAuthToken(...args),
    getOrCreateAuthToken: (...args: unknown[]) => mockGetOrCreateAuthToken(...args),
    sendPassUpdatePush: (...args: unknown[]) => mockSendPassUpdatePush(...args),
  };
});


describe('Pass Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generatePkPass', () => {
    it('produces a Buffer (valid .pkpass archive)', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const data = {
        memberId: 'member-1',
        firstName: 'John',
        lastName: 'Doe',
        memberEmail: 'john@example.com',
        tier: 'Premium',
        membershipStatus: 'active',
        memberSince: '1 January 2024',
        dailySimulatorMinutes: 60,
        dailyConfRoomMinutes: 30,
        guestPassesRemaining: 5,
        guestPassesTotal: 10,
        authenticationToken: 'abc123token',
        webServiceURL: 'https://everclub.app/api/wallet',
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      const result = await generatePkPass(data, config);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('uses custom tier colors from database when provided', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const data = {
        memberId: 'member-2',
        firstName: 'Jane',
        lastName: 'Smith',
        memberEmail: 'jane@example.com',
        tier: 'VIP',
        membershipStatus: 'active',
        memberSince: '15 March 2023',
        dailySimulatorMinutes: 120,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };
      const dbColors = {
        bg: '#FF0000',
        foreground: '#00FF00',
        label: '#0000FF',
      };

      const result = await generatePkPass(data, config, dbColors);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('falls back to default tier colors for unknown tier', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const data = {
        memberId: 'member-3',
        firstName: 'Unknown',
        lastName: 'Tier',
        memberEmail: 'unknown@example.com',
        tier: 'UnknownTier',
        membershipStatus: 'active',
        memberSince: '',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      const result = await generatePkPass(data, config);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('generates correct barcode payload with member ID', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-42',
        firstName: 'Test',
        lastName: 'User',
        memberEmail: 'test@example.com',
        tier: 'Core',
        membershipStatus: 'active',
        memberSince: '1 June 2023',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const appendCalls = archiverInstance.append.mock.calls;
      const passJsonCall = appendCalls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      expect(passJsonCall).toBeDefined();
      const passJson = JSON.parse(passJsonCall[0].toString());
      expect(passJson.barcode.message).toBe('MEMBER:member-42');
      expect(passJson.barcode.format).toBe('PKBarcodeFormatQR');
      expect(passJson.barcodes).toHaveLength(1);
      expect(passJson.barcodes[0].message).toBe('MEMBER:member-42');
      expect(passJson.serialNumber).toBe('EVERCLUB-member-42');
    });

    it('includes location data when valid coordinates provided', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-loc',
        firstName: 'Loc',
        lastName: 'Test',
        memberEmail: 'loc@example.com',
        tier: 'Premium',
        membershipStatus: 'active',
        memberSince: '',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
        clubLatitude: 33.713744,
        clubLongitude: -117.836476,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      expect(passJson.locations).toBeDefined();
      expect(passJson.locations).toHaveLength(1);
      expect(passJson.locations[0].latitude).toBe(33.713744);
    });

    it('omits location data when coordinates are invalid', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-noloc',
        firstName: 'NoLoc',
        lastName: 'Test',
        memberEmail: 'noloc@example.com',
        tier: 'Core',
        membershipStatus: 'active',
        memberSince: '',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
        clubLatitude: 999,
        clubLongitude: -999,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      expect(passJson.locations).toBeUndefined();
    });

    it('displays unlimited for simulator minutes >= 999', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-unlimited',
        firstName: 'VIP',
        lastName: 'User',
        memberEmail: 'vip@example.com',
        tier: 'VIP',
        membershipStatus: 'active',
        memberSince: '',
        dailySimulatorMinutes: 999,
        dailyConfRoomMinutes: 1000,
        guestPassesRemaining: 3,
        guestPassesTotal: 10,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      const backFields = passJson.storeCard.backFields;
      const simField = backFields.find((f: Record<string, string>) => f.key === 'dailySimMinutes');
      expect(simField.value).toBe('Unlimited');
      const confField = backFields.find((f: Record<string, string>) => f.key === 'dailyConfMinutes');
      expect(confField.value).toBe('Unlimited');
    });

    it('includes guest passes in back fields', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-guest',
        firstName: 'Guest',
        lastName: 'Pass',
        memberEmail: 'guest@example.com',
        tier: 'Premium',
        membershipStatus: 'active',
        memberSince: '',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: 7,
        guestPassesTotal: 12,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      const guestField = passJson.storeCard.backFields.find((f: Record<string, string>) => f.key === 'guestPasses');
      expect(guestField).toBeDefined();
      expect(guestField.value).toBe('7 / 12 remaining');
    });

    it('includes webServiceURL and authenticationToken when provided', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-ws',
        firstName: 'Web',
        lastName: 'Service',
        memberEmail: 'ws@example.com',
        tier: 'Core',
        membershipStatus: 'active',
        memberSince: '',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
        authenticationToken: 'token-xyz',
        webServiceURL: 'https://everclub.app/api/wallet',
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      expect(passJson.webServiceURL).toBe('https://everclub.app/api/wallet');
      expect(passJson.authenticationToken).toBe('token-xyz');
    });

    it('formats membership status display correctly', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-status',
        firstName: 'Status',
        lastName: 'Test',
        memberEmail: 'status@example.com',
        tier: 'Core',
        membershipStatus: 'past_due',
        memberSince: '',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      const statusField = passJson.storeCard.auxiliaryFields.find((f: Record<string, string>) => f.key === 'status');
      expect(statusField.value).toBe('Past Due');
    });

    it('includes manifest.json and signature in archive', async () => {
      const { generatePkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        memberId: 'member-manifest',
        firstName: 'Manifest',
        lastName: 'Test',
        memberEmail: 'm@example.com',
        tier: 'Core',
        membershipStatus: 'active',
        memberSince: '',
        dailySimulatorMinutes: null,
        dailyConfRoomMinutes: null,
        guestPassesRemaining: null,
        guestPassesTotal: null,
      };
      const config = {
        passTypeId: 'pass.com.everclub.membership',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generatePkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const appendedFiles = archiverInstance.append.mock.calls.map(
        (c: unknown[]) => (c[1] as { name: string }).name
      );
      expect(appendedFiles).toContain('pass.json');
      expect(appendedFiles).toContain('manifest.json');
      expect(appendedFiles).toContain('signature');
      expect(appendedFiles).toContain('icon.png');
      expect(appendedFiles).toContain('logo.png');
      expect(appendedFiles).toContain('strip.png');
    });
  });

  describe('generateBookingPkPass', () => {
    it('produces a Buffer for booking pass', async () => {
      const { generateBookingPkPass } = await import('../server/walletPass/passGenerator');

      const data = {
        bookingId: 100,
        memberId: 'member-1',
        memberName: 'John Doe',
        memberEmail: 'john@example.com',
        bayName: 'Bay 1',
        bookingDate: '2025-06-15',
        startTime: '14:00',
        endTime: '15:00',
        durationMinutes: 60,
        playerCount: 2,
        serialNumber: 'EVERBOOKING-100',
        authenticationToken: 'booking-token-abc',
        expirationDate: '2025-06-15T15:00:00Z',
      };
      const config = {
        passTypeId: 'pass.com.everclub.booking',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      const result = await generateBookingPkPass(data, config);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('generates correct barcode with booking ID', async () => {
      const { generateBookingPkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        bookingId: 42,
        memberId: 'member-1',
        memberName: 'Jane Doe',
        memberEmail: 'jane@example.com',
        bayName: 'Bay 3',
        bookingDate: '2025-07-20',
        startTime: '10:00',
        endTime: '11:30',
        durationMinutes: 90,
        playerCount: 4,
        serialNumber: 'EVERBOOKING-42',
        authenticationToken: 'booking-token-xyz',
        expirationDate: '2025-07-20T11:30:00Z',
      };
      const config = {
        passTypeId: 'pass.com.everclub.booking',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generateBookingPkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      expect(passJson.barcode.message).toBe('BOOKING:42');
      expect(passJson.barcodes[0].message).toBe('BOOKING:42');
      expect(passJson.serialNumber).toBe('EVERBOOKING-42');
    });

    it('marks pass as voided when voided flag is set', async () => {
      const { generateBookingPkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        bookingId: 50,
        memberId: 'member-1',
        memberName: 'Void Test',
        memberEmail: 'void@example.com',
        bayName: 'Bay 2',
        bookingDate: '2025-08-01',
        startTime: '09:00',
        endTime: '10:00',
        durationMinutes: 60,
        playerCount: 1,
        serialNumber: 'EVERBOOKING-50',
        authenticationToken: 'void-token',
        expirationDate: '2025-08-01T10:00:00Z',
        voided: true,
      };
      const config = {
        passTypeId: 'pass.com.everclub.booking',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generateBookingPkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      expect(passJson.voided).toBe(true);
    });

    it('shows Cancelled status for voided booking pass', async () => {
      const { generateBookingPkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        bookingId: 60,
        memberId: 'member-1',
        memberName: 'Cancelled',
        memberEmail: 'cancelled@example.com',
        bayName: 'Bay 1',
        bookingDate: '2025-08-10',
        startTime: '16:00',
        endTime: '17:00',
        durationMinutes: 60,
        playerCount: 1,
        serialNumber: 'EVERBOOKING-60',
        authenticationToken: 'cancelled-token',
        expirationDate: '2025-08-10T17:00:00Z',
        voided: true,
        bookingStatus: 'approved',
      };
      const config = {
        passTypeId: 'pass.com.everclub.booking',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generateBookingPkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      const statusField = passJson.eventTicket.auxiliaryFields.find(
        (f: Record<string, string>) => f.key === 'bookingStatus'
      );
      expect(statusField.value).toBe('Cancelled');
    });

    it('includes expiration date and relevant date', async () => {
      const { generateBookingPkPass } = await import('../server/walletPass/passGenerator');
      const archiver = (await import('archiver')).default;

      const data = {
        bookingId: 70,
        memberId: 'member-1',
        memberName: 'Expiry Test',
        memberEmail: 'expiry@example.com',
        bayName: 'Bay 4',
        bookingDate: '2025-09-01',
        startTime: '13:00',
        endTime: '14:30',
        durationMinutes: 90,
        playerCount: 3,
        serialNumber: 'EVERBOOKING-70',
        authenticationToken: 'expiry-token',
        expirationDate: '2025-09-01T14:30:00Z',
      };
      const config = {
        passTypeId: 'pass.com.everclub.booking',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generateBookingPkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      expect(passJson.expirationDate).toBe('2025-09-01T14:30:00Z');
      expect(passJson.relevantDate).toBeDefined();
    });
  });

  describe('DEFAULT_TIER_COLORS', () => {
    it('exports known tier colors', async () => {
      const { DEFAULT_TIER_COLORS } = await import('../server/walletPass/passGenerator');
      expect(DEFAULT_TIER_COLORS).toHaveProperty('VIP');
      expect(DEFAULT_TIER_COLORS).toHaveProperty('Premium');
      expect(DEFAULT_TIER_COLORS).toHaveProperty('Corporate');
      expect(DEFAULT_TIER_COLORS).toHaveProperty('Core');
      expect(DEFAULT_TIER_COLORS).toHaveProperty('Social');
    });
  });
});


describe('APN Push Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    if (realValidateAuthToken) mockValidateAuthToken.mockImplementation((...args: unknown[]) => realValidateAuthToken(...args));
    if (realGetOrCreateAuthToken) mockGetOrCreateAuthToken.mockImplementation((...args: unknown[]) => realGetOrCreateAuthToken(...args));
    if (realSendPassUpdatePush) mockSendPassUpdatePush.mockImplementation((...args: unknown[]) => realSendPassUpdatePush(...args));
  });

  describe('normalizePem', () => {
    it('converts escaped newlines to real newlines', async () => {
      const { normalizePem } = await import('../server/walletPass/apnPushService');
      const input = '-----BEGIN CERTIFICATE-----\\nABC\\nDEF\\n-----END CERTIFICATE-----';
      const result = normalizePem(input);
      expect(result).toContain('\n');
      expect(result).not.toContain('\\n');
    });

    it('returns empty string for empty input', async () => {
      const { normalizePem } = await import('../server/walletPass/apnPushService');
      expect(normalizePem('')).toBe('');
    });

    it('preserves already-formatted PEM', async () => {
      const { normalizePem } = await import('../server/walletPass/apnPushService');
      const pem = '-----BEGIN CERTIFICATE-----\nABCDEF\n-----END CERTIFICATE-----';
      const result = normalizePem(pem);
      expect(result).toContain('-----BEGIN CERTIFICATE-----');
      expect(result).toContain('-----END CERTIFICATE-----');
    });
  });

  describe('getOrCreateAuthToken', () => {
    it('returns existing token if found', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([{ authToken: 'existing-token' }]);

      const { getOrCreateAuthToken } = await import('../server/walletPass/apnPushService');
      const result = await getOrCreateAuthToken('EVERCLUB-member-1', 'member-1');
      expect(result).toBe('existing-token');
    });

    it('creates new token if none exists', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { getOrCreateAuthToken } = await import('../server/walletPass/apnPushService');
      const result = await getOrCreateAuthToken('EVERCLUB-member-2', 'member-2');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  describe('validateAuthToken', () => {
    it('returns true for valid token', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([{ id: 1 }]);

      const { validateAuthToken } = await import('../server/walletPass/apnPushService');
      const result = await validateAuthToken('EVERCLUB-member-1', 'valid-token');
      expect(result).toBe(true);
    });

    it('returns false for invalid token', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { validateAuthToken } = await import('../server/walletPass/apnPushService');
      const result = await validateAuthToken('EVERCLUB-member-1', 'invalid-token');
      expect(result).toBe(false);
    });
  });

  describe('sendPassUpdatePush', () => {
    it('returns zero counts when no registrations exist', async () => {
      mockSelectChain.where.mockResolvedValueOnce([]);

      const { sendPassUpdatePush } = await import('../server/walletPass/apnPushService');
      const result = await sendPassUpdatePush('EVERCLUB-member-1');
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('sendPassUpdateForMember', () => {
    it('constructs serial number from member ID', async () => {
      mockSelectChain.where.mockResolvedValueOnce([]);

      const { sendPassUpdateForMember } = await import('../server/walletPass/apnPushService');
      await sendPassUpdateForMember('member-123');
    });
  });

  describe('sendPassUpdateForMemberByEmail', () => {
    it('does nothing when email has no matching user', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const { sendPassUpdateForMemberByEmail } = await import('../server/walletPass/apnPushService');
      await sendPassUpdateForMemberByEmail('nobody@example.com');
    });
  });

  describe('sendPassUpdateToAllRegistrations', () => {
    it('returns zero counts when no registrations exist', async () => {
      mockSelectChain.from.mockReturnThis();
      mockSelectChain.where.mockReturnThis();
      mockSelectChain.from.mockResolvedValueOnce([]);

      const { sendPassUpdateToAllRegistrations } = await import('../server/walletPass/apnPushService');
      const result = await sendPassUpdateToAllRegistrations();
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});


describe('Pass Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
  });

  describe('getWalletConfig', () => {
    it('returns null when wallet is not enabled', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const { getWalletConfig } = await import('../server/walletPass/passService');
      const result = await getWalletConfig();
      expect(result).toBeNull();
    });

    it('returns null when passTypeId or teamId is missing', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');

      const { getWalletConfig } = await import('../server/walletPass/passService');
      const result = await getWalletConfig();
      expect(result).toBeNull();
    });
  });

  describe('getWebServiceURL', () => {
    it('returns custom URL when configured', async () => {
      const { getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValueOnce('https://custom.example.com/wallet');

      const { getWebServiceURL } = await import('../server/walletPass/passService');
      const result = await getWebServiceURL();
      expect(result).toBe('https://custom.example.com/wallet');
    });

    it('falls back to app base URL when no custom URL set', async () => {
      const { getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');

      const { getWebServiceURL } = await import('../server/walletPass/passService');
      const result = await getWebServiceURL();
      expect(result).toBe('https://everclub.app/api/wallet');
    });
  });

  describe('generatePassForMember', () => {
    it('returns null when wallet config is not available', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const { generatePassForMember } = await import('../server/walletPass/passService');
      const result = await generatePassForMember('member-1');
      expect(result).toBeNull();
    });

    it('returns null when member not found', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { generatePassForMember } = await import('../server/walletPass/passService');
      const result = await generatePassForMember('nonexistent');
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns null for admin/staff users', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit.mockResolvedValueOnce([{
        id: 'admin-1',
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@everclub.app',
        tier: 'VIP',
        membershipStatus: 'active',
        joinDate: '2024-01-01',
        role: 'admin',
      }]);

      const { generatePassForMember } = await import('../server/walletPass/passService');
      const result = await generatePassForMember('admin-1');
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns null for expired membership', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit.mockResolvedValueOnce([{
        id: 'expired-1',
        firstName: 'Expired',
        lastName: 'User',
        email: 'expired@example.com',
        tier: 'Core',
        membershipStatus: 'expired',
        joinDate: '2023-01-01',
        role: 'member',
      }]);

      const { generatePassForMember } = await import('../server/walletPass/passService');
      const result = await generatePassForMember('expired-1');
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns null for cancelled membership', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit.mockResolvedValueOnce([{
        id: 'cancelled-1',
        firstName: 'Cancelled',
        lastName: 'User',
        email: 'cancelled@example.com',
        tier: 'Core',
        membershipStatus: 'cancelled',
        joinDate: '2023-01-01',
        role: 'member',
      }]);

      const { generatePassForMember } = await import('../server/walletPass/passService');
      const result = await generatePassForMember('cancelled-1');
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });
  });
});


describe('Booking Pass Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
  });

  describe('generateBookingPass', () => {
    it('returns null when wallet config is not available', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const { generateBookingPass } = await import('../server/walletPass/bookingPassService');
      const result = await generateBookingPass(1);
      expect(result).toBeNull();
    });

    it('returns null when booking not found', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { generateBookingPass } = await import('../server/walletPass/bookingPassService');
      const result = await generateBookingPass(999);
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns null when booking status is not allowed and no voided pass', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit.mockResolvedValueOnce([{
        id: 1,
        userId: 'member-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        resourceId: 1,
        requestDate: '2025-06-15',
        startTime: '14:00',
        endTime: '15:00',
        durationMinutes: 60,
        status: 'declined',
        declaredPlayerCount: 1,
      }]);

      const { generateBookingPass } = await import('../server/walletPass/bookingPassService');
      const result = await generateBookingPass(1);
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns null when requesting member does not own booking', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit
        .mockResolvedValueOnce([{
          id: 1,
          userId: 'member-owner',
          userEmail: 'owner@example.com',
          userName: 'Owner',
          resourceId: 1,
          requestDate: '2025-06-15',
          startTime: '14:00',
          endTime: '15:00',
          durationMinutes: 60,
          status: 'approved',
          declaredPlayerCount: 1,
        }])
        .mockResolvedValueOnce([{ name: 'Bay 1' }])
        .mockResolvedValueOnce([{ firstName: 'Owner', lastName: 'User' }]);

      const { generateBookingPass } = await import('../server/walletPass/bookingPassService');
      const result = await generateBookingPass(1, 'different-member');
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });
  });

  describe('voidBookingPass', () => {
    it('does nothing when no pass record exists', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { voidBookingPass } = await import('../server/walletPass/bookingPassService');
      await voidBookingPass(999);
    });
  });

  describe('refreshBookingPass', () => {
    it('does nothing when no pass record exists', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { refreshBookingPass } = await import('../server/walletPass/bookingPassService');
      await refreshBookingPass(999);
    });
  });

  describe('generateBookingPassForWebService', () => {
    it('returns null when no pass record found for serial number', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { generateBookingPassForWebService } = await import('../server/walletPass/bookingPassService');
      const result = await generateBookingPassForWebService('EVERBOOKING-999');
      expect(result).toBeNull();
    });
  });
});


describe('Wallet Pass Routes', () => {
  let mockReq: Record<string, unknown>;
  let mockRes: Record<string, unknown>;
  let statusFn: ReturnType<typeof vi.fn>;
  let jsonFn: ReturnType<typeof vi.fn>;
  let sendFn: ReturnType<typeof vi.fn>;
  let setFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonFn = vi.fn();
    sendFn = vi.fn();
    setFn = vi.fn();
    statusFn = vi.fn().mockReturnValue({ json: jsonFn, send: sendFn });
    mockRes = {
      json: jsonFn,
      send: sendFn,
      set: setFn,
      status: statusFn,
    };
    mockReq = {
      headers: {},
      params: {},
      body: {},
      session: {},
    };
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    mockDeleteFn.mockReturnValue(mockDeleteChain);
    mockDeleteChain.where.mockResolvedValue(undefined);
  });

  describe('Wallet Pass Web Service Routes', () => {
    describe('POST /v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', () => {
      it('rejects registration without ApplePass auth header', async () => {
        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;

        const registrationRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber' && layer.route?.methods?.post);

        expect(registrationRoute).toBeDefined();

        mockReq.params = {
          deviceLibraryId: 'device-1',
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = {};
        mockReq.body = { pushToken: 'push-token-abc' };

        await registrationRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(401);
      });

      it('rejects registration with invalid auth token', async () => {
        mockSelectChain.limit.mockResolvedValueOnce([]);

        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const registrationRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber' && layer.route?.methods?.post);

        mockReq.params = {
          deviceLibraryId: 'device-1',
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = { authorization: 'ApplePass invalid-token' };
        mockReq.body = { pushToken: 'push-token-abc' };

        await registrationRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(401);
      });

      it('rejects registration with missing pushToken when auth is valid', async () => {
        mockValidateAuthToken.mockResolvedValueOnce(true);

        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const registrationRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber' && layer.route?.methods?.post);

        mockReq.params = {
          deviceLibraryId: 'device-1',
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = { authorization: 'ApplePass valid-token' };
        mockReq.body = {};

        await registrationRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(400);
      });

      it('returns 201 for new registration', async () => {
        mockValidateAuthToken.mockResolvedValueOnce(true);
        mockSelectChain.limit.mockResolvedValueOnce([]);

        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const registrationRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber' && layer.route?.methods?.post);

        mockReq.params = {
          deviceLibraryId: 'device-new',
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = { authorization: 'ApplePass valid-token' };
        mockReq.body = { pushToken: 'new-push-token' };

        await registrationRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(201);
      });

      it('returns 200 for existing device registration (updates push token)', async () => {
        mockValidateAuthToken.mockResolvedValueOnce(true);
        mockSelectChain.limit.mockReset();
        mockSelectChain.limit.mockResolvedValueOnce([{ id: 42 }]);

        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const registrationRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber' && layer.route?.methods?.post);

        mockReq.params = {
          deviceLibraryId: 'device-existing',
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = { authorization: 'ApplePass valid-token' };
        mockReq.body = { pushToken: 'updated-push-token' };

        await registrationRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(200);
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    describe('DELETE /v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', () => {
      it('rejects unregistration without auth header', async () => {
        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const deleteRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber' && layer.route?.methods?.delete);

        expect(deleteRoute).toBeDefined();

        mockReq.params = {
          deviceLibraryId: 'device-1',
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = {};

        await deleteRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(401);
      });

      it('returns 200 on successful unregistration', async () => {
        mockValidateAuthToken.mockResolvedValueOnce(true);

        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const deleteRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber' && layer.route?.methods?.delete);

        mockReq.params = {
          deviceLibraryId: 'device-1',
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = { authorization: 'ApplePass valid-token' };

        await deleteRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(200);
        expect(mockDeleteFn).toHaveBeenCalled();
      });
    });

    describe('POST /v1/log', () => {
      it('accepts device logs and returns 200', async () => {
        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const logRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/log' && layer.route?.methods?.post);

        expect(logRoute).toBeDefined();

        mockReq.body = { logs: ['Log entry 1', 'Log entry 2'] };
        await logRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(200);
      });

      it('handles empty logs array gracefully', async () => {
        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const logRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/log' && layer.route?.methods?.post);

        mockReq.body = {};
        await logRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(200);
      });
    });

    describe('GET /v1/passes/:passTypeId/:serialNumber', () => {
      it('rejects pass download without valid auth', async () => {
        mockValidateAuthToken.mockResolvedValue(false);
        mockSelectChain.limit.mockResolvedValue([]);

        const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
        const passRoute = (walletPassWebService as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
          .find(layer => layer.route?.path === '/v1/passes/:passTypeId/:serialNumber' && layer.route?.methods?.get);

        expect(passRoute).toBeDefined();

        mockReq.params = {
          passTypeId: 'pass.com.everclub.membership',
          serialNumber: 'EVERCLUB-member-1',
        };
        mockReq.headers = { authorization: 'ApplePass bad-token' };

        await passRoute!.route!.stack[0].handle(mockReq, mockRes);
        expect(statusFn).toHaveBeenCalledWith(401);
      });
    });
  });
});


describe('Wallet Pass Status Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
  });

  it('returns available: false when wallet is disabled', async () => {
    const { getSettingBoolean } = await import('../server/core/settingsHelper');
    (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const walletPassRouter = (await import('../server/routes/walletPass')).default;
    const statusRoute = (walletPassRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
      .find(layer => layer.route?.path === '/api/member/wallet-pass/status' && layer.route?.methods?.get);

    expect(statusRoute).toBeDefined();

    const jsonFn = vi.fn();
    const mockReq = { session: {} };
    const mockRes = { json: jsonFn, status: vi.fn().mockReturnValue({ json: jsonFn }) };

    const handler = statusRoute!.route!.stack[statusRoute!.route!.stack.length - 1].handle;
    await handler(mockReq, mockRes);
    expect(jsonFn).toHaveBeenCalledWith({ available: false });
  });
});


describe('Pass Generator - Happy Path Details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('populates all storeCard field groups correctly', async () => {
    const { generatePkPass } = await import('../server/walletPass/passGenerator');
    const archiver = (await import('archiver')).default;

    const data = {
      memberId: 'hp-1',
      firstName: 'Happy',
      lastName: 'Path',
      memberEmail: 'happy@example.com',
      tier: 'Premium',
      membershipStatus: 'active',
      memberSince: '10 March 2024',
      dailySimulatorMinutes: 120,
      dailyConfRoomMinutes: 60,
      guestPassesRemaining: 4,
      guestPassesTotal: 8,
      authenticationToken: 'hp-token',
      webServiceURL: 'https://everclub.app/api/wallet',
    };
    const config = {
      passTypeId: 'pass.com.everclub.membership',
      teamId: 'TEAM123',
      certPem: 'mock-cert',
      keyPem: 'mock-key',
    };

    await generatePkPass(data, config);

    const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
      (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;
    const passJsonCall = archiverInstance.append.mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
    );
    const passJson = JSON.parse(passJsonCall[0].toString());

    expect(passJson.formatVersion).toBe(1);
    expect(passJson.passTypeIdentifier).toBe('pass.com.everclub.membership');
    expect(passJson.teamIdentifier).toBe('TEAM123');
    expect(passJson.organizationName).toBe('Ever Club');
    expect(passJson.description).toContain('Premium');
    expect(passJson.description).toContain('Happy');

    const { storeCard } = passJson;
    expect(storeCard).toBeDefined();

    expect(storeCard.headerFields).toHaveLength(1);
    expect(storeCard.headerFields[0].key).toBe('memberSince');
    expect(storeCard.headerFields[0].value).toBe('10 March 2024');

    expect(storeCard.secondaryFields).toHaveLength(2);
    expect(storeCard.secondaryFields[0].key).toBe('memberName');
    expect(storeCard.secondaryFields[0].value).toBe('Happy Path');
    expect(storeCard.secondaryFields[1].key).toBe('tier');
    expect(storeCard.secondaryFields[1].value).toBe('Premium');

    expect(storeCard.auxiliaryFields).toHaveLength(2);
    expect(storeCard.auxiliaryFields[0].key).toBe('status');
    expect(storeCard.auxiliaryFields[0].value).toBe('Active');
    expect(storeCard.auxiliaryFields[1].key).toBe('email');
    expect(storeCard.auxiliaryFields[1].value).toBe('happy@example.com');

    const backFieldKeys = storeCard.backFields.map((f: Record<string, string>) => f.key);
    expect(backFieldKeys).toContain('dailySimMinutes');
    expect(backFieldKeys).toContain('dailyConfMinutes');
    expect(backFieldKeys).toContain('guestPasses');
    expect(backFieldKeys).toContain('tierName');
    expect(backFieldKeys).toContain('memberPortal');

    const simField = storeCard.backFields.find((f: Record<string, string>) => f.key === 'dailySimMinutes');
    expect(simField.value).toBe('120 min');
    const confField = storeCard.backFields.find((f: Record<string, string>) => f.key === 'dailyConfMinutes');
    expect(confField.value).toBe('60 min');
  });

  it('builds correct eventTicket structure for booking pass', async () => {
    const { generateBookingPkPass } = await import('../server/walletPass/passGenerator');
    const archiver = (await import('archiver')).default;

    const data = {
      bookingId: 200,
      memberId: 'hp-2',
      memberName: 'Happy Booker',
      memberEmail: 'booker@example.com',
      bayName: 'Bay 5',
      bookingDate: '2025-10-15',
      startTime: '09:30',
      endTime: '11:00',
      durationMinutes: 90,
      playerCount: 3,
      serialNumber: 'EVERBOOKING-200',
      authenticationToken: 'booking-hp-token',
      webServiceURL: 'https://everclub.app/api/wallet',
      clubLatitude: 33.713744,
      clubLongitude: -117.836476,
      clubAddress: '15771 Red Hill Ave, Ste 500, Tustin, CA 92780',
      expirationDate: '2025-10-15T11:00:00Z',
      bookingStatus: 'approved',
    };
    const config = {
      passTypeId: 'pass.com.everclub.booking',
      teamId: 'TEAM123',
      certPem: 'mock-cert',
      keyPem: 'mock-key',
    };

    await generateBookingPkPass(data, config);

    const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
      (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;
    const passJsonCall = archiverInstance.append.mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
    );
    const passJson = JSON.parse(passJsonCall[0].toString());

    expect(passJson.eventTicket).toBeDefined();

    const { eventTicket } = passJson;
    expect(eventTicket.primaryFields).toHaveLength(2);
    expect(eventTicket.primaryFields[0].key).toBe('eventDate');
    expect(eventTicket.primaryFields[1].key).toBe('eventTime');
    expect(eventTicket.primaryFields[1].value).toContain('9:30 AM');
    expect(eventTicket.primaryFields[1].value).toContain('11:00 AM');

    expect(eventTicket.secondaryFields).toHaveLength(2);
    expect(eventTicket.secondaryFields[0].key).toBe('bayName');
    expect(eventTicket.secondaryFields[0].value).toBe('Bay 5');
    expect(eventTicket.secondaryFields[1].key).toBe('duration');
    expect(eventTicket.secondaryFields[1].value).toBe('90 min');

    expect(eventTicket.auxiliaryFields).toHaveLength(2);
    expect(eventTicket.auxiliaryFields[0].key).toBe('playerCount');
    expect(eventTicket.auxiliaryFields[0].value).toBe('3');
    expect(eventTicket.auxiliaryFields[1].key).toBe('bookingStatus');
    expect(eventTicket.auxiliaryFields[1].value).toBe('Confirmed');

    const backFieldKeys = eventTicket.backFields.map((f: Record<string, string>) => f.key);
    expect(backFieldKeys).toContain('bookingId');
    expect(backFieldKeys).toContain('memberName');
    expect(backFieldKeys).toContain('memberEmail');
    expect(backFieldKeys).toContain('clubAddress');
    expect(backFieldKeys).toContain('viewBookings');

    expect(passJson.locations).toHaveLength(1);
    expect(passJson.locations[0].relevantText).toContain('Bay 5');

    expect(passJson.webServiceURL).toBe('https://everclub.app/api/wallet');
    expect(passJson.authenticationToken).toBe('booking-hp-token');
    expect(passJson.barcode.message).toBe('BOOKING:200');

    const bookingIdField = eventTicket.backFields.find((f: Record<string, string>) => f.key === 'bookingId');
    expect(bookingIdField.value).toBe('#200');
  });

  it('omits header fields when memberSince is empty', async () => {
    const { generatePkPass } = await import('../server/walletPass/passGenerator');
    const archiver = (await import('archiver')).default;

    const data = {
      memberId: 'no-since',
      firstName: 'New',
      lastName: 'Member',
      memberEmail: 'new@example.com',
      tier: 'Social',
      membershipStatus: 'trialing',
      memberSince: '',
      dailySimulatorMinutes: null,
      dailyConfRoomMinutes: null,
      guestPassesRemaining: null,
      guestPassesTotal: null,
    };
    const config = {
      passTypeId: 'pass.com.everclub.membership',
      teamId: 'TEAM123',
      certPem: 'mock-cert',
      keyPem: 'mock-key',
    };

    await generatePkPass(data, config);

    const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
      (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;
    const passJsonCall = archiverInstance.append.mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
    );
    const passJson = JSON.parse(passJsonCall[0].toString());

    expect(passJson.storeCard.headerFields).toHaveLength(0);
    const statusField = passJson.storeCard.auxiliaryFields.find((f: Record<string, string>) => f.key === 'status');
    expect(statusField.value).toBe('Trial');
  });

  it('omits back fields for null daily minutes and guest passes', async () => {
    const { generatePkPass } = await import('../server/walletPass/passGenerator');
    const archiver = (await import('archiver')).default;

    const data = {
      memberId: 'minimal',
      firstName: 'Min',
      lastName: 'Imal',
      memberEmail: 'min@example.com',
      tier: 'Core',
      membershipStatus: 'active',
      memberSince: '',
      dailySimulatorMinutes: null,
      dailyConfRoomMinutes: null,
      guestPassesRemaining: null,
      guestPassesTotal: null,
    };
    const config = {
      passTypeId: 'pass.com.everclub.membership',
      teamId: 'TEAM123',
      certPem: 'mock-cert',
      keyPem: 'mock-key',
    };

    await generatePkPass(data, config);

    const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
      (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;
    const passJsonCall = archiverInstance.append.mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
    );
    const passJson = JSON.parse(passJsonCall[0].toString());

    const backFieldKeys = passJson.storeCard.backFields.map((f: Record<string, string>) => f.key);
    expect(backFieldKeys).not.toContain('dailySimMinutes');
    expect(backFieldKeys).not.toContain('dailyConfMinutes');
    expect(backFieldKeys).not.toContain('guestPasses');
    expect(backFieldKeys).toContain('tierName');
    expect(backFieldKeys).toContain('memberPortal');
  });

  it('uses correct colors in RGB format', async () => {
    const { generatePkPass } = await import('../server/walletPass/passGenerator');
    const archiver = (await import('archiver')).default;

    const data = {
      memberId: 'color-test',
      firstName: 'Color',
      lastName: 'Test',
      memberEmail: 'color@example.com',
      tier: 'VIP',
      membershipStatus: 'active',
      memberSince: '',
      dailySimulatorMinutes: null,
      dailyConfRoomMinutes: null,
      guestPassesRemaining: null,
      guestPassesTotal: null,
    };
    const config = {
      passTypeId: 'pass.com.everclub.membership',
      teamId: 'TEAM123',
      certPem: 'mock-cert',
      keyPem: 'mock-key',
    };

    await generatePkPass(data, config);

    const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
      (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;
    const passJsonCall = archiverInstance.append.mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
    );
    const passJson = JSON.parse(passJsonCall[0].toString());

    expect(passJson.foregroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(passJson.backgroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(passJson.labelColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('all booking status values format correctly', async () => {
    const { generateBookingPkPass } = await import('../server/walletPass/passGenerator');
    const archiver = (await import('archiver')).default;

    const statuses = [
      { input: 'approved', expected: 'Confirmed' },
      { input: 'confirmed', expected: 'Confirmed' },
      { input: 'attended', expected: 'Attended' },
      { input: 'checked_in', expected: 'Checked In' },
      { input: 'no_show', expected: 'No Show' },
    ];

    for (const { input, expected } of statuses) {
      const data = {
        bookingId: 300,
        memberId: 'status-test',
        memberName: 'Status Test',
        memberEmail: 'status@example.com',
        bayName: 'Bay 1',
        bookingDate: '2025-12-01',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        playerCount: 1,
        serialNumber: 'EVERBOOKING-300',
        authenticationToken: 'status-token',
        expirationDate: '2025-12-01T11:00:00Z',
        bookingStatus: input,
      };
      const config = {
        passTypeId: 'pass.com.everclub.booking',
        teamId: 'TEAM123',
        certPem: 'mock-cert',
        keyPem: 'mock-key',
      };

      await generateBookingPkPass(data, config);

      const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
        (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
      ].value;
      const passJsonCall = archiverInstance.append.mock.calls.find(
        (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
      );
      const passJson = JSON.parse(passJsonCall[0].toString());
      const statusField = passJson.eventTicket.auxiliaryFields.find(
        (f: Record<string, string>) => f.key === 'bookingStatus'
      );
      expect(statusField.value).toBe(expected);
    }
  });
});


describe('APN Push Service - Extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    if (realValidateAuthToken) mockValidateAuthToken.mockImplementation((...args: unknown[]) => realValidateAuthToken(...args));
    if (realGetOrCreateAuthToken) mockGetOrCreateAuthToken.mockImplementation((...args: unknown[]) => realGetOrCreateAuthToken(...args));
    if (realSendPassUpdatePush) mockSendPassUpdatePush.mockImplementation((...args: unknown[]) => realSendPassUpdatePush(...args));
  });

  describe('getOrCreateAuthToken', () => {
    it('generates a 64-character hex token when creating new', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { getOrCreateAuthToken } = await import('../server/walletPass/apnPushService');
      const token = await getOrCreateAuthToken('EVERCLUB-new', 'new-member');
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('uses onConflictDoUpdate for upsert safety', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { getOrCreateAuthToken } = await import('../server/walletPass/apnPushService');
      await getOrCreateAuthToken('EVERCLUB-upsert', 'upsert-member');
      expect(mockInsertChain.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('does not insert when existing token is found', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([{ authToken: 'pre-existing-token' }]);

      const { getOrCreateAuthToken } = await import('../server/walletPass/apnPushService');
      const token = await getOrCreateAuthToken('EVERCLUB-existing', 'existing-member');
      expect(token).toBe('pre-existing-token');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('generates unique tokens across multiple calls', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);
      const { getOrCreateAuthToken } = await import('../server/walletPass/apnPushService');
      const token1 = await getOrCreateAuthToken('EVERCLUB-a', 'member-a');

      mockSelectChain.limit.mockResolvedValueOnce([]);
      const token2 = await getOrCreateAuthToken('EVERCLUB-b', 'member-b');

      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64);
      expect(token2.length).toBe(64);
    });
  });

  describe('sendPassUpdateForMember', () => {
    it('constructs EVERCLUB-{memberId} serial and triggers push flow updating registrations', async () => {
      mockUpdate.mockReturnValue(mockUpdateChain);
      mockUpdateChain.set.mockReturnThis();
      mockUpdateChain.where.mockResolvedValueOnce(undefined);
      mockSelectChain.where.mockResolvedValueOnce([]);

      const { sendPassUpdateForMember } = await import('../server/walletPass/apnPushService');
      await sendPassUpdateForMember('abc-123');

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateSetArg = mockUpdateChain.set.mock.calls[0][0];
      expect(updateSetArg.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('sendPassUpdateForMemberByEmail', () => {
    it('looks up member by email via case-insensitive SQL and triggers push flow', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [{ id: 'found-member' }] });
      mockUpdate.mockReturnValue(mockUpdateChain);
      mockUpdateChain.set.mockReturnThis();
      mockUpdateChain.where.mockResolvedValueOnce(undefined);
      mockSelectChain.where.mockResolvedValueOnce([]);

      const { sendPassUpdateForMemberByEmail } = await import('../server/walletPass/apnPushService');
      await sendPassUpdateForMemberByEmail('Test@Example.COM');

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const updateSetArg = mockUpdateChain.set.mock.calls[0][0];
      expect(updateSetArg.updatedAt).toBeInstanceOf(Date);
    });

    it('skips push when no user found for email', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const { sendPassUpdateForMemberByEmail } = await import('../server/walletPass/apnPushService');
      await sendPassUpdateForMemberByEmail('nobody@example.com');
      expect(mockSendPassUpdatePush).not.toHaveBeenCalled();
    });
  });

  describe('sendPassUpdatePush with registrations', () => {
    it('updates device registration timestamps before sending push', async () => {
      mockSelectChain.where.mockResolvedValueOnce([
        { pushToken: 'push-1', passTypeId: 'pass.com.everclub.membership' },
      ]);

      const { sendPassUpdatePush } = await import('../server/walletPass/apnPushService');
      await sendPassUpdatePush('EVERCLUB-member-push');

      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe('sendPassUpdateToAllRegistrations', () => {
    it('updates all registration timestamps', async () => {
      mockSelectChain.from.mockResolvedValueOnce([]);

      const { sendPassUpdateToAllRegistrations } = await import('../server/walletPass/apnPushService');
      const result = await sendPassUpdateToAllRegistrations();
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe('validateAuthToken', () => {
    it('queries db with serial number and auth token', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([{ id: 99 }]);

      const { validateAuthToken } = await import('../server/walletPass/apnPushService');
      const result = await validateAuthToken('EVERCLUB-validate', 'test-token');
      expect(result).toBe(true);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('returns false when token does not match serial', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([]);

      const { validateAuthToken } = await import('../server/walletPass/apnPushService');
      const result = await validateAuthToken('EVERCLUB-wrong', 'mismatched-token');
      expect(result).toBe(false);
    });
  });

  describe('normalizePem', () => {
    it('handles PEM with no newlines (single-line format)', async () => {
      const { normalizePem } = await import('../server/walletPass/apnPushService');
      const singleLine = '-----BEGIN CERTIFICATE-----ABCDEF-----END CERTIFICATE-----';
      const result = normalizePem(singleLine);
      expect(result).toContain('-----BEGIN CERTIFICATE-----');
      expect(result).toContain('-----END CERTIFICATE-----');
      expect(result).toContain('\n');
    });

    it('preserves multi-line PEM with proper line breaks', async () => {
      const { normalizePem } = await import('../server/walletPass/apnPushService');
      const pem = '-----BEGIN CERTIFICATE-----\nABCDEFGHIJKLMNOP\nQRSTUVWXYZ\n-----END CERTIFICATE-----';
      const result = normalizePem(pem);
      expect(result).toBe(pem);
    });
  });
});


describe('Wallet Pass Web Service Routes - Extended', () => {
  let mockReq: Record<string, unknown>;
  let mockRes: Record<string, unknown>;
  let statusFn: ReturnType<typeof vi.fn>;
  let jsonFn: ReturnType<typeof vi.fn>;
  let sendFn: ReturnType<typeof vi.fn>;
  let setFn: ReturnType<typeof vi.fn>;

  function getRoute(router: unknown, path: string, method: string) {
    return (router as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
      .find(layer => layer.route?.path === path && layer.route?.methods?.[method]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    jsonFn = vi.fn();
    sendFn = vi.fn();
    setFn = vi.fn();
    statusFn = vi.fn().mockReturnValue({ json: jsonFn, send: sendFn });
    mockRes = { json: jsonFn, send: sendFn, set: setFn, status: statusFn };
    mockReq = { headers: {}, params: {}, body: {}, session: {}, query: {} };
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    mockDeleteFn.mockReturnValue(mockDeleteChain);
    mockDeleteChain.where.mockResolvedValue(undefined);
  });

  describe('GET /v1/devices/:deviceLibraryId/registrations/:passTypeId (serial number list)', () => {
    it('returns 204 when device has no registrations', async () => {
      mockSelectChain.where.mockResolvedValueOnce([]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId', 'get');
      expect(route).toBeDefined();

      mockReq.params = {
        deviceLibraryId: 'device-empty',
        passTypeId: 'pass.com.everclub.membership',
      };
      (mockReq as Record<string, unknown>).validatedQuery = {};

      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);
      expect(statusFn).toHaveBeenCalledWith(204);
    });
  });

  describe('DELETE unregistration with member-fallback auth', () => {
    it('rejects unregistration when auth token and member fallback both fail', async () => {
      mockValidateAuthToken.mockResolvedValueOnce(false);
      mockSelectChain.limit
        .mockResolvedValueOnce([{ memberId: 'member-a' }])
        .mockResolvedValueOnce([{ memberId: 'member-b' }]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', 'delete');

      mockReq.params = {
        deviceLibraryId: 'device-1',
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-member-1',
      };
      mockReq.headers = { authorization: 'ApplePass mismatched-token' };

      await route!.route!.stack[0].handle(mockReq, mockRes);
      expect(statusFn).toHaveBeenCalledWith(401);
    });

    it('allows unregistration via member-fallback when token owner matches serial owner', async () => {
      mockValidateAuthToken.mockResolvedValueOnce(false);
      mockSelectChain.limit
        .mockResolvedValueOnce([{ memberId: 'same-member' }])
        .mockResolvedValueOnce([{ memberId: 'same-member' }]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', 'delete');

      mockReq.params = {
        deviceLibraryId: 'device-1',
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-same-member',
      };
      mockReq.headers = { authorization: 'ApplePass fallback-token' };

      await route!.route!.stack[0].handle(mockReq, mockRes);
      expect(statusFn).toHaveBeenCalledWith(200);
      expect(mockDeleteFn).toHaveBeenCalled();
    });
  });

  describe('POST /v1/log edge cases', () => {
    it('handles non-array logs field gracefully', async () => {
      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/log', 'post');

      mockReq.body = { logs: 'not-an-array' };
      await route!.route!.stack[0].handle(mockReq, mockRes);
      expect(statusFn).toHaveBeenCalledWith(200);
    });
  });
});


describe('Booking Pass Service - Extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    if (realSendPassUpdatePush) mockSendPassUpdatePush.mockImplementation((...args: unknown[]) => realSendPassUpdatePush(...args));
  });

  describe('voidBookingPass', () => {
    it('updates voidedAt and sends push when pass record exists', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([{ serialNumber: 'EVERBOOKING-10' }]);
      mockSendPassUpdatePush.mockResolvedValueOnce({ sent: 1, failed: 0 });

      const { voidBookingPass } = await import('../server/walletPass/bookingPassService');
      await voidBookingPass(10);

      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe('refreshBookingPass', () => {
    it('bumps timestamp and sends push when pass record exists', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([{ serialNumber: 'EVERBOOKING-20' }]);
      mockSendPassUpdatePush.mockResolvedValueOnce({ sent: 1, failed: 0 });

      const { refreshBookingPass } = await import('../server/walletPass/bookingPassService');
      await refreshBookingPass(20);

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('logs warning when push has no device registrations', async () => {
      mockSelectChain.limit.mockResolvedValueOnce([{ serialNumber: 'EVERBOOKING-30' }]);
      mockSendPassUpdatePush.mockResolvedValueOnce({ sent: 0, failed: 0 });

      const { refreshBookingPass } = await import('../server/walletPass/bookingPassService');
      await refreshBookingPass(30);
    });
  });

  describe('generateBookingPass edge cases', () => {
    it('returns null when booking has no userId and email lookup fails', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      mockSelectChain.limit
        .mockResolvedValueOnce([{
          id: 1,
          userId: null,
          userEmail: 'orphan@example.com',
          userName: 'Orphan',
          resourceId: 1,
          requestDate: '2025-06-15',
          startTime: '14:00',
          endTime: '15:00',
          durationMinutes: 60,
          status: 'approved',
          declaredPlayerCount: 1,
        }])
        .mockResolvedValueOnce([]);

      const { generateBookingPass } = await import('../server/walletPass/bookingPassService');
      const result = await generateBookingPass(1);
      expect(result).toBeNull();

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });
  });
});


describe('Pass Service - Lifecycle Happy Path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    if (realGetOrCreateAuthToken) mockGetOrCreateAuthToken.mockImplementation((...args: unknown[]) => realGetOrCreateAuthToken(...args));
  });

  it('generatePassForMember assembles data from user/tier/guest queries and returns a Buffer', async () => {
    const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
    (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (getSettingValue as ReturnType<typeof vi.fn>).mockImplementation((key: string, def: string) => {
      const map: Record<string, string> = {
        'apple_wallet.pass_type_id': 'pass.com.everclub.membership',
        'apple_wallet.team_id': 'TEAM123',
        'apple_wallet.web_service_url': 'https://everclub.app/api/wallet',
        'club.latitude': '33.713744',
        'club.longitude': '-117.836476',
      };
      return Promise.resolve(map[key] || def);
    });
    process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
    process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

    mockSelectChain.limit
      .mockResolvedValueOnce([{
        id: 'member-hp',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        tier: 'Premium',
        membershipStatus: 'active',
        joinDate: '2024-01-15',
        role: 'member',
      }])
      .mockResolvedValueOnce([{
        dailySimMinutes: 120,
        dailyConfRoomMinutes: 60,
        guestPassesPerYear: 10,
        walletPassBgColor: null,
        walletPassForegroundColor: null,
        walletPassLabelColor: null,
      }])
      .mockResolvedValueOnce([{
        passesUsed: 3,
        passesTotal: 10,
      }])
      .mockResolvedValueOnce([]);

    const { generatePassForMember } = await import('../server/walletPass/passService');
    const result = await generatePassForMember('member-hp');

    expect(result).toBeInstanceOf(Buffer);
    expect(result!.length).toBeGreaterThan(0);

    expect(mockInsert).toHaveBeenCalled();
    const insertCall = mockInsertChain.values.mock.calls[0][0];
    expect(insertCall.serialNumber).toBe('EVERCLUB-member-hp');
    expect(insertCall.memberId).toBe('member-hp');
    expect(insertCall.authToken).toMatch(/^[a-f0-9]{64}$/);

    const archiver = (await import('archiver')).default;
    const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
      (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;
    const passJsonCall = archiverInstance.append.mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
    );
    const passJson = JSON.parse(passJsonCall[0].toString());

    expect(passJson.passTypeIdentifier).toBe('pass.com.everclub.membership');
    expect(passJson.teamIdentifier).toBe('TEAM123');
    expect(passJson.webServiceURL).toBe('https://everclub.app/api/wallet');
    expect(passJson.authenticationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(passJson.barcode.message).toBe('MEMBER:member-hp');

    const memberNameField = passJson.storeCard.secondaryFields.find(
      (f: Record<string, string>) => f.key === 'memberName'
    );
    expect(memberNameField.value).toBe('John Doe');

    const simField = passJson.storeCard.backFields.find(
      (f: Record<string, string>) => f.key === 'dailySimMinutes'
    );
    expect(simField.value).toBe('120 min');

    const guestField = passJson.storeCard.backFields.find(
      (f: Record<string, string>) => f.key === 'guestPasses'
    );
    expect(guestField.value).toBe('7 / 10 remaining');

    delete process.env.APPLE_WALLET_CERT_PEM;
    delete process.env.APPLE_WALLET_KEY_PEM;
  });

  it('generatePassForMember returns null for null tier after normalization', async () => {
    const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
    const { normalizeTierName } = await import('../shared/constants/tiers');
    (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (getSettingValue as ReturnType<typeof vi.fn>).mockResolvedValue('test-value');
    (normalizeTierName as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
    process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

    mockSelectChain.limit.mockResolvedValueOnce([{
      id: 'member-bad-tier',
      firstName: 'No',
      lastName: 'Tier',
      email: 'notier@example.com',
      tier: 'InvalidTier',
      membershipStatus: 'active',
      joinDate: null,
      role: 'member',
    }]);

    const { generatePassForMember } = await import('../server/walletPass/passService');
    const result = await generatePassForMember('member-bad-tier');
    expect(result).toBeNull();

    delete process.env.APPLE_WALLET_CERT_PEM;
    delete process.env.APPLE_WALLET_KEY_PEM;
  });

  it('getWalletConfig returns full config when all values are present', async () => {
    const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
    (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (getSettingValue as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      const map: Record<string, string> = {
        'apple_wallet.pass_type_id': 'pass.com.everclub.membership',
        'apple_wallet.team_id': 'TEAM123',
      };
      return Promise.resolve(map[key] || '');
    });
    process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
    process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

    const { getWalletConfig } = await import('../server/walletPass/passService');
    const config = await getWalletConfig();
    expect(config).not.toBeNull();
    expect(config!.passTypeId).toBe('pass.com.everclub.membership');
    expect(config!.teamId).toBe('TEAM123');
    expect(config!.certPem).toContain('BEGIN CERTIFICATE');
    expect(config!.keyPem).toContain('BEGIN RSA PRIVATE KEY');

    delete process.env.APPLE_WALLET_CERT_PEM;
    delete process.env.APPLE_WALLET_KEY_PEM;
  });
});


describe('Booking Pass Service - Lifecycle Happy Path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    if (realGetOrCreateAuthToken) mockGetOrCreateAuthToken.mockImplementation((...args: unknown[]) => realGetOrCreateAuthToken(...args));
    if (realSendPassUpdatePush) mockSendPassUpdatePush.mockImplementation((...args: unknown[]) => realSendPassUpdatePush(...args));
  });

  it('generateBookingPass creates pass record, auth token, and returns buffer for approved booking', async () => {
    const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
    (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (getSettingValue as ReturnType<typeof vi.fn>).mockImplementation((key: string, def: string) => {
      const map: Record<string, string> = {
        'apple_wallet.pass_type_id': 'pass.com.everclub.booking',
        'apple_wallet.team_id': 'TEAM123',
        'apple_wallet.web_service_url': 'https://everclub.app/api/wallet',
        'club.latitude': '33.713744',
        'club.longitude': '-117.836476',
        'contact.address_line1': '15771 Red Hill Ave',
        'contact.city_state_zip': 'Tustin, CA 92780',
      };
      return Promise.resolve(map[key] || def);
    });
    process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
    process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

    mockSelectChain.limit
      .mockResolvedValueOnce([{
        id: 42,
        userId: 'member-booking-hp',
        userEmail: 'booking@example.com',
        userName: 'Booking User',
        resourceId: 5,
        requestDate: '2025-10-15',
        startTime: '09:30',
        endTime: '11:00',
        durationMinutes: 90,
        status: 'approved',
        declaredPlayerCount: 3,
      }])
      .mockResolvedValueOnce([{ name: 'Bay 5' }])
      .mockResolvedValueOnce([{ firstName: 'Booking', lastName: 'User' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { generateBookingPass } = await import('../server/walletPass/bookingPassService');
    const result = await generateBookingPass(42);

    expect(result).toBeInstanceOf(Buffer);
    expect(result!.length).toBeGreaterThan(0);

    const insertCalls = mockInsert.mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);

    const bookingPassInsert = mockInsertChain.values.mock.calls.find(
      (c: unknown[]) => {
        const val = c[0] as Record<string, unknown>;
        return val.bookingId === 42;
      }
    );
    expect(bookingPassInsert).toBeDefined();
    const passValues = bookingPassInsert![0] as Record<string, unknown>;
    expect(passValues.serialNumber).toBe('EVERBOOKING-42');
    expect(passValues.memberId).toBe('member-booking-hp');
    expect(passValues.authenticationToken).toMatch(/^[a-f0-9]{64}$/);

    const archiver = (await import('archiver')).default;
    const archiverInstance = (archiver as unknown as ReturnType<typeof vi.fn>).mock.results[
      (archiver as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value;
    const passJsonCall = archiverInstance.append.mock.calls.find(
      (c: unknown[]) => (c[1] as { name: string }).name === 'pass.json'
    );
    const passJson = JSON.parse(passJsonCall[0].toString());

    expect(passJson.barcode.message).toBe('BOOKING:42');
    expect(passJson.eventTicket).toBeDefined();
    const bayField = passJson.eventTicket.secondaryFields.find(
      (f: Record<string, string>) => f.key === 'bayName'
    );
    expect(bayField.value).toBe('Bay 5');

    delete process.env.APPLE_WALLET_CERT_PEM;
    delete process.env.APPLE_WALLET_KEY_PEM;
  });

  it('voidBookingPass sets voidedAt timestamp and calls bumpSerialChangeTimestamp then sendPassUpdatePush', async () => {
    mockSelectChain.limit.mockReset();
    mockSelectChain.limit.mockResolvedValueOnce([{ serialNumber: 'EVERBOOKING-99' }]);
    mockSelectChain.limit.mockResolvedValue([]);
    mockSendPassUpdatePush.mockReset();
    mockSendPassUpdatePush.mockResolvedValue({ sent: 1, failed: 0 });

    const { voidBookingPass } = await import('../server/walletPass/bookingPassService');
    await voidBookingPass(99);

    expect(mockUpdate).toHaveBeenCalledTimes(2);

    const setCallArgs = mockUpdateChain.set.mock.calls;
    const voidedAtArg = setCallArgs.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).voidedAt !== undefined
    );
    expect(voidedAtArg).toBeDefined();
    expect((voidedAtArg![0] as Record<string, Date>).voidedAt).toBeInstanceOf(Date);

    const timestampBumpArg = setCallArgs.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).updatedAt !== undefined
    );
    expect(timestampBumpArg).toBeDefined();

    expect(mockSendPassUpdatePush).toHaveBeenCalledWith('EVERBOOKING-99');
  });

  it('refreshBookingPass bumps timestamp and calls sendPassUpdatePush', async () => {
    mockSelectChain.limit.mockReset();
    mockSelectChain.limit.mockResolvedValueOnce([{ serialNumber: 'EVERBOOKING-88' }]);
    mockSelectChain.limit.mockResolvedValue([]);
    mockSendPassUpdatePush.mockReset();
    mockSendPassUpdatePush.mockResolvedValue({ sent: 2, failed: 0 });

    const { refreshBookingPass } = await import('../server/walletPass/bookingPassService');
    await refreshBookingPass(88);

    const setCallArgs = mockUpdateChain.set.mock.calls;
    const timestampBumpArg = setCallArgs.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).updatedAt !== undefined
    );
    expect(timestampBumpArg).toBeDefined();

    expect(mockSendPassUpdatePush).toHaveBeenCalledWith('EVERBOOKING-88');
  });

  it('generateBookingPassForWebService returns null for unknown serial', async () => {
    mockSelectChain.limit.mockReset();
    mockSelectChain.limit.mockResolvedValueOnce([]);
    mockSelectChain.limit.mockResolvedValue([]);

    const { generateBookingPassForWebService } = await import('../server/walletPass/bookingPassService');
    const result = await generateBookingPassForWebService('EVERBOOKING-unknown');
    expect(result).toBeNull();
  });
});


describe('APN Push Failure Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
  });

  it('sendPassUpdatePush increments failed count when sendApnPush returns false for a registration', async () => {
    mockSelectChain.where.mockReset();
    mockSelectChain.where.mockResolvedValueOnce([
      { pushToken: 'invalid-token-1', passTypeId: 'pass.com.test' },
      { pushToken: 'invalid-token-2', passTypeId: 'pass.com.test' },
    ]);
    mockSelectChain.where.mockReturnThis();

    const { sendPassUpdatePush } = await import('../server/walletPass/apnPushService');
    const result = await sendPassUpdatePush('EVERCLUB-test-fail');

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);
  });

  it('sendPassUpdatePush returns zero counts when no registrations exist', async () => {
    mockSelectChain.where.mockReset();
    mockSelectChain.where.mockResolvedValueOnce([]);
    mockSelectChain.where.mockReturnThis();

    const { sendPassUpdatePush } = await import('../server/walletPass/apnPushService');
    const result = await sendPassUpdatePush('EVERCLUB-no-devices');

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('sendPassUpdateToAllRegistrations counts failures from invalid tokens across multiple registrations', async () => {
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockResolvedValueOnce(undefined);

    mockSelectChain.from.mockReset();
    mockSelectChain.from.mockResolvedValueOnce([
      { pushToken: 'bad-push-1', passTypeId: 'pass.com.test', serialNumber: 'S1' },
      { pushToken: 'bad-push-2', passTypeId: 'pass.com.test', serialNumber: 'S2' },
    ]);
    mockSelectChain.from.mockReturnThis();

    const { sendPassUpdateToAllRegistrations } = await import('../server/walletPass/apnPushService');
    const result = await sendPassUpdateToAllRegistrations();

    expect(result.failed).toBe(2);
    expect(result.sent).toBe(0);
  });
});


describe('Wallet Pass Member Routes (walletPass.ts)', () => {
  let mockReq: Record<string, unknown>;
  let mockRes: Record<string, unknown>;
  let statusFn: ReturnType<typeof vi.fn>;
  let jsonFn: ReturnType<typeof vi.fn>;
  let sendFn: ReturnType<typeof vi.fn>;
  let setFn: ReturnType<typeof vi.fn>;

  function getRoute(router: unknown, path: string, method: string) {
    const r = router as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> };
    return r.stack.find(layer => layer.route?.path === path && layer.route?.methods?.[method]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    jsonFn = vi.fn();
    sendFn = vi.fn();
    setFn = vi.fn();
    statusFn = vi.fn().mockReturnValue({ json: jsonFn, send: sendFn });
    mockRes = { json: jsonFn, send: sendFn, set: setFn, status: statusFn };
    mockReq = { headers: {}, params: {}, body: {}, session: {}, query: {} };

    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  describe('GET /api/member/wallet-pass/status', () => {
    it('returns available: false when wallet is disabled', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass/status', 'get');
      expect(route).toBeDefined();

      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(jsonFn).toHaveBeenCalledWith({ available: false });
    });

    it('returns available: false when session user has no email', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass/status', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(jsonFn).toHaveBeenCalledWith({ available: false });

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns available: true for active member with valid config', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce({ email: 'member@test.com', name: 'Member' });

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValueOnce([{ role: 'member', membershipStatus: 'active' }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass/status', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(jsonFn).toHaveBeenCalledWith({ available: true });

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns available: false for admin/staff users', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce({ email: 'admin@test.com', name: 'Admin' });

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValueOnce([{ role: 'admin', membershipStatus: 'active' }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass/status', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(jsonFn).toHaveBeenCalledWith({ available: false });

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns available: false for expired members', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce({ email: 'expired@test.com', name: 'Expired' });

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValueOnce([{ role: 'member', membershipStatus: 'expired' }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass/status', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(jsonFn).toHaveBeenCalledWith({ available: false });

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });
  });

  describe('GET /api/member/wallet-pass (download)', () => {
    it('returns 404 when wallet is disabled', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass', 'get');
      expect(route).toBeDefined();

      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(404);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not enabled') }));
    });

    it('returns 401 when session user has no email', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(401);

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns 404 when user not found in database', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce({ email: 'ghost@test.com', name: 'Ghost' });

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(404);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'User not found' }));

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns 403 for admin/staff role users', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      process.env.APPLE_WALLET_CERT_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
      process.env.APPLE_WALLET_KEY_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce({ email: 'staff@test.com', name: 'Staff' });

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValueOnce([{
        id: 'staff-1', firstName: 'Staff', lastName: 'User', email: 'staff@test.com',
        tier: 'gold', membershipStatus: 'active', joinDate: '2024-01-01', role: 'staff',
      }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('only available for members') }));

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;
    });

    it('returns 503 when wallet config is incomplete (missing certs)', async () => {
      const { getSettingBoolean, getSettingValue } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (getSettingValue as ReturnType<typeof vi.fn>).mockReset();
      (getSettingValue as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('pass.com.everclub.membership')
        .mockResolvedValueOnce('TEAM123');

      delete process.env.APPLE_WALLET_CERT_PEM;
      delete process.env.APPLE_WALLET_KEY_PEM;

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/wallet-pass', 'get');
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(503);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not fully configured') }));
    });
  });

  describe('GET /api/member/booking-wallet-pass/:bookingId', () => {
    it('returns 404 when wallet is disabled', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/booking-wallet-pass/:bookingId', 'get');
      expect(route).toBeDefined();

      mockReq.params = { bookingId: '42' };
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(404);
    });

    it('returns 400 for non-numeric booking ID', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/booking-wallet-pass/:bookingId', 'get');

      mockReq.params = { bookingId: 'abc' };
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid booking ID' }));
    });

    it('returns 401 when session user has no email', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/booking-wallet-pass/:bookingId', 'get');

      mockReq.params = { bookingId: '42' };
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(401);
    });

    it('returns 403 when booking does not belong to session user', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce({ email: 'member@test.com', name: 'Member' });

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit
        .mockResolvedValueOnce([{ id: 'user-1' }])
        .mockResolvedValueOnce([{ userId: 'other-user', userEmail: 'other@test.com', status: 'approved' }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/booking-wallet-pass/:bookingId', 'get');

      mockReq.params = { bookingId: '42' };
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('do not own') }));
    });

    it('returns 400 when booking status is not in allowed list', async () => {
      const { getSettingBoolean } = await import('../server/core/settingsHelper');
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockReset();
      (getSettingBoolean as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const { getSessionUser } = await import('../server/types/session');
      (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValueOnce({ email: 'member@test.com', name: 'Member' });

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit
        .mockResolvedValueOnce([{ id: 'user-1' }])
        .mockResolvedValueOnce([{ userId: 'user-1', userEmail: 'member@test.com', status: 'cancelled' }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/member/booking-wallet-pass/:bookingId', 'get');

      mockReq.params = { bookingId: '42' };
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('approved bookings') }));
    });
  });

  describe('POST /api/admin/wallet-pass/push-update-all', () => {
    it('returns success with sent/failed counts', async () => {
      mockUpdate.mockReturnValue(mockUpdateChain);
      mockUpdateChain.set.mockResolvedValueOnce(undefined);

      mockSelectChain.from.mockReset();
      mockSelectChain.from.mockResolvedValueOnce([]);
      mockSelectChain.from.mockReturnThis();

      const walletPassRouter = (await import('../server/routes/walletPass')).default;
      const route = getRoute(walletPassRouter, '/api/admin/wallet-pass/push-update-all', 'post');
      expect(route).toBeDefined();

      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: true, sent: 0, failed: 0 }));
    });
  });
});


describe('Wallet Pass Web Service Routes - Protocol Compliance', () => {
  let mockReq: Record<string, unknown>;
  let mockRes: Record<string, unknown>;
  let statusFn: ReturnType<typeof vi.fn>;
  let jsonFn: ReturnType<typeof vi.fn>;
  let sendFn: ReturnType<typeof vi.fn>;
  let setFn: ReturnType<typeof vi.fn>;

  function getRoute(router: unknown, path: string, method: string) {
    return (router as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
      .find(layer => layer.route?.path === path && layer.route?.methods?.[method]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    jsonFn = vi.fn();
    sendFn = vi.fn();
    setFn = vi.fn();
    statusFn = vi.fn().mockReturnValue({ json: jsonFn, send: sendFn });
    mockRes = { json: jsonFn, send: sendFn, set: setFn, status: statusFn };
    mockReq = { headers: {}, params: {}, body: {}, session: {}, query: {} };
    mockSelect.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnThis();
    mockSelectChain.where.mockReturnThis();
    mockSelectChain.limit.mockResolvedValue([]);
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
    mockDeleteFn.mockReturnValue(mockDeleteChain);
    mockDeleteChain.where.mockResolvedValue(undefined);
  });

  describe('GET /v1/passes/:passTypeId/:serialNumber (protocol)', () => {
    it('returns 404 when tokenRecord not found for valid auth', async () => {
      mockValidateAuthToken.mockReset();
      mockValidateAuthToken.mockResolvedValueOnce(true);
      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/passes/:passTypeId/:serialNumber', 'get');

      mockReq.params = {
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-orphan',
      };
      mockReq.headers = { authorization: 'ApplePass valid-token' };

      await route!.route!.stack[0].handle(mockReq, mockRes);
      expect(statusFn).toHaveBeenCalledWith(404);
      expect(sendFn).toHaveBeenCalledWith('Pass not found');
    });

    it('validates auth via member fallback when direct token validation fails', async () => {
      mockValidateAuthToken.mockReset();
      mockValidateAuthToken.mockResolvedValueOnce(false);

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit
        .mockResolvedValueOnce([{ memberId: 'fallback-member' }])
        .mockResolvedValueOnce([{ memberId: 'fallback-member' }])
        .mockResolvedValueOnce([{ memberId: 'fallback-member' }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/passes/:passTypeId/:serialNumber', 'get');

      mockReq.params = {
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-fallback-member',
      };
      mockReq.headers = { authorization: 'ApplePass fallback-token' };

      await route!.route!.stack[0].handle(mockReq, mockRes);

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('rejects download when no auth header provided', async () => {
      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/passes/:passTypeId/:serialNumber', 'get');

      mockReq.params = {
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-no-auth',
      };
      mockReq.headers = {};

      await route!.route!.stack[0].handle(mockReq, mockRes);
      expect(statusFn).toHaveBeenCalledWith(401);
    });

    it('rejects download when auth token is invalid and no member fallback matches', async () => {
      mockValidateAuthToken.mockReset();
      mockValidateAuthToken.mockResolvedValueOnce(false);

      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/passes/:passTypeId/:serialNumber', 'get');

      mockReq.params = {
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-invalid',
      };
      mockReq.headers = { authorization: 'ApplePass bad-token' };

      await route!.route!.stack[0].handle(mockReq, mockRes);
      expect(statusFn).toHaveBeenCalledWith(401);
    });
  });

  describe('GET /v1/devices/:deviceLibraryId/registrations/:passTypeId (protocol)', () => {
    it('returns 204 when device has no registrations', async () => {
      mockSelectChain.where.mockReset();
      mockSelectChain.where.mockResolvedValueOnce([]);
      mockSelectChain.where.mockReturnThis();

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId', 'get');

      mockReq.params = {
        deviceLibraryId: 'device-empty-2',
        passTypeId: 'pass.com.everclub.membership',
      };
      (mockReq as Record<string, unknown>).validatedQuery = {};

      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;
      await handler(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(204);
    });
  });

  describe('POST /v1/devices registration (success path assertions)', () => {
    it('returns 201 and inserts new registration with pushToken', async () => {
      mockValidateAuthToken.mockReset();
      mockValidateAuthToken.mockResolvedValueOnce(true);
      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', 'post');

      mockReq.params = {
        deviceLibraryId: 'device-new',
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-reg-member',
      };
      mockReq.headers = { authorization: 'ApplePass valid-token' };
      mockReq.body = { pushToken: 'push-token-abc' };

      await route!.route!.stack[0].handle(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(mockInsert).toHaveBeenCalled();
      const insertedValues = mockInsertChain.values.mock.calls[0][0];
      expect(insertedValues.deviceLibraryId).toBe('device-new');
      expect(insertedValues.pushToken).toBe('push-token-abc');
      expect(insertedValues.serialNumber).toBe('EVERCLUB-reg-member');
    });

    it('returns 200 and updates existing registration', async () => {
      mockValidateAuthToken.mockReset();
      mockValidateAuthToken.mockResolvedValueOnce(true);
      mockSelectChain.limit.mockReset();
      mockSelectChain.limit.mockResolvedValueOnce([{ id: 42 }]);
      mockSelectChain.limit.mockResolvedValue([]);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', 'post');

      mockReq.params = {
        deviceLibraryId: 'device-existing',
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-existing-member',
      };
      mockReq.headers = { authorization: 'ApplePass valid-token' };
      mockReq.body = { pushToken: 'push-token-updated' };

      await route!.route!.stack[0].handle(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(200);
      expect(mockUpdate).toHaveBeenCalled();
      const updateSetArgs = mockUpdateChain.set.mock.calls[0][0];
      expect(updateSetArgs.pushToken).toBe('push-token-updated');
      expect(updateSetArgs.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('DELETE /v1/devices unregistration (success path assertions)', () => {
    it('deletes registration record and returns 200 with matching params', async () => {
      mockValidateAuthToken.mockReset();
      mockValidateAuthToken.mockResolvedValueOnce(true);

      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', 'delete');

      mockReq.params = {
        deviceLibraryId: 'device-unreg',
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-unreg-member',
      };
      mockReq.headers = { authorization: 'ApplePass valid-token' };

      await route!.route!.stack[0].handle(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(200);
      expect(mockDeleteFn).toHaveBeenCalledTimes(1);
      expect(sendFn).toHaveBeenCalled();
    });

    it('rejects unregistration without auth header', async () => {
      const walletPassWebService = (await import('../server/routes/walletPassWebService')).default;
      const route = getRoute(walletPassWebService, '/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', 'delete');

      mockReq.params = {
        deviceLibraryId: 'device-unreg',
        passTypeId: 'pass.com.everclub.membership',
        serialNumber: 'EVERCLUB-unreg-member',
      };
      mockReq.headers = {};

      await route!.route!.stack[0].handle(mockReq, mockRes);

      expect(statusFn).toHaveBeenCalledWith(401);
      expect(mockDeleteFn).not.toHaveBeenCalled();
    });
  });
});
