// Debug script v2 — inspects inner instruction bytes in detail
import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config();

const sig = process.argv[2];
if (!sig) { console.error('Usage: npx tsx scripts/debugInstruction.ts <signature>'); process.exit(1); }

const connection = new Connection(process.env.HELIUS_RPC_URL!, 'confirmed');
const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

(async () => {
  const tx = await connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  if (!tx) { console.log('TX not found'); return; }

  // Try to parse a buffer at various offsets
  const tryParse = (buf: Buffer, label: string) => {
    console.log(`\n[${label}] ${buf.length} bytes`);
    console.log('  hex:', buf.toString('hex'));
    for (const startOffset of [0, 1, 8, 9, 12, 16]) {
      try {
        let offset = startOffset;
        const readStr = (): string => {
          if (offset + 4 > buf.length) throw new Error('EOF');
          const len = buf.readUInt32LE(offset);
          if (len > 200 || len === 0) throw new Error(`bad len ${len}`);
          offset += 4;
          if (offset + len > buf.length) throw new Error('EOF str');
          const s = buf.subarray(offset, offset + len).toString('utf8');
          offset += len;
          return s;
        };
        const name = readStr();
        const symbol = readStr();
        const uri = readStr();
        if ((name + symbol + uri).match(/[^\x20-\x7E]/)) throw new Error('non-printable chars');
        console.log(`  ✅ offset ${startOffset}: name="${name}" symbol="${symbol}" uri="${uri.substring(0,80)}"`);
      } catch(e: any) {
        console.log(`  ❌ offset ${startOffset}: ${e.message}`);
      }
    }
  };

  // Check outer pump.fun instructions
  tx.transaction.message.instructions.forEach((ix, i) => {
    if ('data' in ix && ix.programId.toBase58() === PUMP_FUN) {
      const buf = Buffer.from(ix.data as string, 'base64');
      tryParse(buf, `Outer ix[${i}]`);
    }
  });

  // Check inner pump.fun instructions
  tx.meta?.innerInstructions?.forEach((group) => {
    group.instructions.forEach((ix: any, i: number) => {
      const pid = ix.programId?.toBase58?.() ?? ix.programId;
      if (pid === PUMP_FUN && ix.data) {
        const buf = Buffer.from(ix.data as string, 'base64');
        tryParse(buf, `Inner[outer=${group.index}][ix=${i}]`);
      }
    });
  });
})();
