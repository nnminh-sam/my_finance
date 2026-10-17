import type { Metadata } from 'next';
import { AuthScreen } from '../../../components/AuthScreen';
import { pages } from '../../../lib/pages';

export const metadata: Metadata = {
  title: pages.signup.title,
};

export default function SignupPage() {
  return <AuthScreen mode="signup" />;
}
