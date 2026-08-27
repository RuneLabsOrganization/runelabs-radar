import { siteMeta } from '@/lib/seo';
import { paths } from '@/lib/urls';

export const metadata = siteMeta(
  'Forgot password',
  'Reset your Radar password.',
  paths.forgotPassword,
  { index: false },
);

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
