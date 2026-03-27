import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';

dotenv.config();

const seedAdmin = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/mill';
    await mongoose.connect(mongoUri);
    
    const adminExists = await User.findOne({ role: 'superadmin' });
    
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password: 'admin123', // Will be hashed by pre-save hook
        role: 'superadmin'
      });
      console.log('✅ Super Admin user created (admin / admin123)');
    } else {
      console.log('ℹ️ Super Admin already exists');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();
