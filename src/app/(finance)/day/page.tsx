import type { Metadata } from 'next';
import { DayPageView } from '../../../components/FinancePageViews';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.day.title,
};

export default function DayPage() {
  return <DayPageView />;
}
