import type { Metadata } from 'next';
import { SalaryCyclePageView } from '../../../components/FinancePageViews';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.cycle.title,
};

export default function SalaryCyclePage() {
  return <SalaryCyclePageView />;
}
