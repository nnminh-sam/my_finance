import type { Metadata } from 'next';
import { AnalyticsPageView } from '../../../components/FinancePageViews';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.analytics.title,
};

export default function AnalyticsPage() {
  return <AnalyticsPageView />;
}
