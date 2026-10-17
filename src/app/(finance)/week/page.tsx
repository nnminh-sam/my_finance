import type { Metadata } from 'next';
import { WeekPageView } from '../../../components/FinancePageViews';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.week.title,
};

export default function WeekPage() {
  return <WeekPageView />;
}
