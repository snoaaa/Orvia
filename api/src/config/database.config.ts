export interface DatabaseConfig {
  url: string;
}

export const databaseConfig = (): { database: DatabaseConfig } => ({
  database: {
    url:
      process.env.DATABASE_URL ||
      'mysql://wamdp_api_user:HOVAJIGGA2100@localhost:3306/wamdp_db',
  },
});
