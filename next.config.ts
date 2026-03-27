import type { NextConfig } from 'next';

const isDevelopment = process.env.NODE_ENV !== 'production';

function buildContentSecurityPolicy(): string {
  const connectSources = isDevelopment
    ? ["'self'", 'https:', 'http://localhost:*', 'ws://localhost:*']
    : ["'self'", 'https:'];

  const scriptSources = isDevelopment
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:']
    : ["'self'", "'unsafe-inline'"];

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
    ['script-src', scriptSources],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connectSources],
    ['worker-src', ["'self'", 'blob:']],
  ];

  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

const nextConfig: NextConfig = {
  async headers() {
    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value: buildContentSecurityPolicy(),
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ];

    if (!isDevelopment) {
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }

    const headers = await Promise.resolve(securityHeaders);

    return [
      {
        source: '/:path*',
        headers,
      },
    ];
  },
};

export default nextConfig;
