

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getUsers = async (req, res) => {
  const { User } = req.models;
  const users = await User.find({}).select('-password');
  res.json({ success: true, data: users });
};

// @desc    Register a new user
// @route   POST /api/users
// @access  Private/Admin
export const createUser = async (req, res) => {
  const { User } = req.models;
  const { name, username, password, role } = req.body;

  const userExists = await User.findOne({ username });

  if (userExists) {
    return res.status(400).json({ success: false, message: 'User already exists' });
  }

  const user = await User.create({
    name,
    username,
    password,
    role,
  });

  if (user) {
    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        username: user.username,
        role: user.role,
      },
    });
  } else {
    res.status(400).json({ success: false, message: 'Invalid user data' });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private/Admin
export const updateUser = async (req, res) => {
  const { User } = req.models;
  const user = await User.findById(req.params.id);

  if (user) {
    user.name = req.body.name || user.name;
    user.username = req.body.username || user.username;
    user.role = req.body.role || user.role;

    if (req.body.password) {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    res.json({
      success: true,
      data: {
        _id: updatedUser._id,
        name: updatedUser.name,
        username: updatedUser.username,
        role: updatedUser.role,
      },
    });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = async (req, res) => {
  const { User } = req.models;
  const user = await User.findById(req.params.id);

  if (user) {
    if (user.role === 'superadmin') {
      // Check if it's the last superadmin?
      const admins = await User.countDocuments({ role: 'superadmin' });
      if (admins <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot delete the only super admin' });
      }
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User removed' });
  } else {
    res.status(404).json({ success: false, message: 'User not found' });
  }
};
