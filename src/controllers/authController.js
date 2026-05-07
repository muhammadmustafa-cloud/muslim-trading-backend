import jwt from 'jsonwebtoken';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'supersecretjwtkey_12345', {
    expiresIn: '30d',
  });
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  const { User } = req.models;
  const { username, password } = req.body;

  const user = await User.findOne({ username });

  if (user && (await user.matchPassword(password))) {
    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        role: user.role,
        token: generateToken(user._id),
      },
    });
  } else {
    res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
export const getProfile = async (req, res) => {
  const { User } = req.models;
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        role: user.role,
      },
    });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
};

// @desc    Change user password
// @route   PUT /api/auth/change-password
// @access  Private
export const changePassword = async (req, res) => {
  const { User } = req.models;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // Validation
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ 
      success: false, 
      message: 'All fields are required' 
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ 
      success: false, 
      message: 'New passwords do not match' 
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ 
      success: false, 
      message: 'Password must be at least 6 characters long' 
    });
  }

  // Get user
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  // Verify current password
  const isCurrentPasswordValid = await user.matchPassword(currentPassword);
  if (!isCurrentPasswordValid) {
    return res.status(400).json({ 
      success: false, 
      message: 'Current password is incorrect' 
    });
  }

  // Update password
  user.password = newPassword;
  await user.save();

  res.json({ 
    success: true, 
    message: 'Password changed successfully' 
  });
};
