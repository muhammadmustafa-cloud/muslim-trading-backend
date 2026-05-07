import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './src/models/User.js';

dotenv.config();

const fixAdminPassword = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/mill';
    await mongoose.connect(mongoUri);
    
    // Find the admin user
    const admin = await User.findOne({ username: 'admin@mill.com' });
    
    if (!admin) {
      console.log('❌ Admin user not found');
      process.exit(1);
    }
    
    // Hash the password "password123"
    const newPassword = 'password123';
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update the password with proper hash
    await User.updateOne(
      { _id: admin._id },
      { password: hashedPassword }
    );
    
    console.log('✅ Admin password fixed successfully');
    console.log(`   Username: admin@mill.com`);
    console.log(`   Password: password123`);
    console.log(`   Password is now properly hashed`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing password:', error);
    process.exit(1);
  }
};

fixAdminPassword();
