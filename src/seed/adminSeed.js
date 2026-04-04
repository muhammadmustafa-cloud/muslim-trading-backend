
import logger from '../utils/logger.js';

export const seedAdminUser = async (models) => {
  const { User } = models;
  try {
    const adminExists = await User.findOne({ role: 'superadmin' });
    if (!adminExists) {
      logger.info('No superadmin found. Seeding initial admin account...');
      
      // Note: The User model has a pre-save hook that hashes the password automatically.
      await User.create({
        name: 'Super Admin',
        username: 'admin@mill.com',
        password: 'password123',
        role: 'superadmin'
      });
      
      logger.info('Superadmin created: admin@mill.com / password123');
    } else {
      logger.info('Superadmin already exists. Skipping seed.');
    }
  } catch (error) {
    logger.error('Failed to seed admin user:', error.message);
  }
};
