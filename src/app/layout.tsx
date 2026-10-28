import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FPT AI Token Factory | A city of possibilities',
  description: 'Explore the FPT AI Token Factory. Seven model districts, one connected AI city.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
