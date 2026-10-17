import type { Metadata } from 'next';
import { CalendarPageView } from '../../../components/FinancePageViews';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.calendar.title,
};

export default function CalendarPage() {
  return <CalendarPageView />;
}
