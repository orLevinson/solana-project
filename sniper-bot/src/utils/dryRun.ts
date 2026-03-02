import { wallet } from './wallet';
import { logger } from '../logger/logger';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

class DryRunState {
    public virtualBalance: number | null = null;

    async getBalance(): Promise<number> {
        if (this.virtualBalance === null) {
            this.virtualBalance = await wallet.getBalance();
            logger.info('[DRY RUN] Initialized virtual balance', { balance: this.virtualBalance });
        }
        return this.virtualBalance;
    }

    updateBalance(solDelta: number) {
        if (this.virtualBalance !== null) {
            this.virtualBalance += solDelta;
            logger.info('[DRY RUN] Virtual balance updated', {
                change: solDelta > 0 ? `+${solDelta.toFixed(4)}` : solDelta.toFixed(4),
                newBalance: this.virtualBalance.toFixed(4)
            });
        }
    }
}

export const dryRunState = new DryRunState();
