import type { Metadata } from 'next';
import { AuthScreen } from '../../../components/AuthScreen';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.login.title,
};

export default function LoginPage() {
  return <AuthScreen mode="login" />;
}
