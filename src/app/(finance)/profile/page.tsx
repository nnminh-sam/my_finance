import type { Metadata } from 'next';
import { ProfilePageView } from '../../../components/FinancePageViews';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.profile.title,
};

export default function ProfilePage() {
  return <ProfilePageView />;
}
