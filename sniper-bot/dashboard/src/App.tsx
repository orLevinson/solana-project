import { Layout } from './components/Layout';
import { Overview } from './components/Overview';
import { BalanceChart } from './components/BalanceChart';
import { ActiveTokens } from './components/ActiveTokens';
import { TokenArchive } from './components/TokenArchive';

function App() {
  return (
    <Layout>
      <Overview />
      <BalanceChart />
      <ActiveTokens />
      <TokenArchive />
    </Layout>
  );
}

export default App;
