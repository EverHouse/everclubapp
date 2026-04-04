import { createHash } from 'crypto';
import { getWaiverPlainText } from '../../shared/waiver-content';

export function getWaiverDocumentText(version: string): string {
  return getWaiverPlainText(version);
}

export function computeDocumentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
