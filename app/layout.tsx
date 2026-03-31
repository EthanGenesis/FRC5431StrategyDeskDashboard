import './globals.css';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import Script from 'next/script';

const uiFont = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'TBA + Statbotics Strategy Dashboard',
  description: 'Local FRC strategy desk dashboard',
};

const legacyBrowserCompatScript = `
  (function () {
    if (typeof globalThis === 'undefined') {
      if (typeof self !== 'undefined') self.globalThis = self;
      else if (typeof window !== 'undefined') window.globalThis = window;
      else if (typeof global !== 'undefined') global.globalThis = global;
    }
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${uiFont.variable} ${monoFont.variable}`}>
        <Script
          id="legacy-browser-compat"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: legacyBrowserCompatScript }}
        />
        {children}
      </body>
    </html>
  );
}
