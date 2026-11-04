import type { Metadata } from 'next';
import { PlansPageView } from '../../../components/FinancePageViews';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.plans.title,
};

export default function PlansPage() {
  return <PlansPageView />;
}
