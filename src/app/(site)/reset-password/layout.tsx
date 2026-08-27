import { siteMeta } from '@/lib/seo';
import { paths } from '@/lib/urls';

export const metadata = siteMeta(
  'Reset password',
  'Choose a new Radar password.',
  paths.resetPassword,
  { index: false },
);

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
