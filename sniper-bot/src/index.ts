import { startTokenListener, NewTokenEvent } from './listener/tokenListener';

startTokenListener((token: NewTokenEvent) => {
  console.log('\n🚀 NEW TOKEN DETECTED');
  console.log('  Mint      :', token.mint);
  console.log('  Dev       :', token.devWallet);
  console.log('  Detected  :', new Date(token.timestamp).toISOString());
});
