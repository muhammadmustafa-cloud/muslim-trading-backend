import Category from '../models/Category.js';

export const list = async (req, res) => {
  const categories = await Category.find({}).sort({ order: 1, name: 1 }).lean();
  res.json({ success: true, data: categories });
};

export const getById = async (req, res) => {
  const category = await Category.findById(req.params.id).lean();
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, data: category });
};

export const create = async (req, res) => {
  const { name, order } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const existing = await Category.findOne({ name: name.trim() });
  if (existing) {
    return res.status(400).json({ success: false, message: 'Category with this name already exists' });
  }
  const category = await Category.create({
    name: name.trim(),
    order: order != null ? Number(order) : 0,
  });
  res.status(201).json({ success: true, data: category });
};

export const update = async (req, res) => {
  const { name, order } = req.body;
  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ success: false, message: 'Name is required' });
    const existing = await Category.findOne({ name: trimmed, _id: { $ne: req.params.id } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category with this name already exists' });
    }
    category.name = trimmed;
  }
  if (order !== undefined) category.order = Number(order) || 0;
  await category.save();
  res.json({ success: true, data: category.toObject() });
};

export const remove = async (req, res) => {
  const deleted = await Category.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, message: 'Category deleted' });
};
