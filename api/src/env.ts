function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
export const env = {
  databaseUrl: req('DATABASE_URL'),
  appSecret: req('APP_SECRET'),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  port: Number(process.env.PORT ?? 4000),
};
