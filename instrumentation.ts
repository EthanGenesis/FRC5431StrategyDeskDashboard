export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { registerOpenTelemetry } = await import('./lib/otel-node');
  await registerOpenTelemetry();
}
