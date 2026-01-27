import { requestWithLog } from '../utils/network/fetch-retry.ts';

export async function headStatus(url: string): Promise<number> {
  const resp = await requestWithLog(url, { method: 'HEAD' });
  return resp.statusCode;
}
