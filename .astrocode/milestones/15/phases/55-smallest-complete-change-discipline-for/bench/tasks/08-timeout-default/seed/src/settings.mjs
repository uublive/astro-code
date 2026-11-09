export function loadSettings(env = process.env) {
  return {
    host: env.HOST || 'localhost',
    port: Number(env.PORT) || 3000,
  }
}
