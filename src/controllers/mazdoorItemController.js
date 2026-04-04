

export const list = async (req, res) => {
  const { MazdoorItem } = req.models;
  const search = (req.query.search || '').trim();
  const filter = search ? { name: new RegExp(search, 'i') } : {};
  const items = await MazdoorItem.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, data: items });
};

export const getById = async (req, res) => {
  const { MazdoorItem } = req.models;
  const item = await MazdoorItem.findById(req.params.id).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Mazdoor item not found' });
  }
  res.json({ success: true, data: item });
};

export const create = async (req, res) => {
  const { MazdoorItem } = req.models;
  const { name, rate, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const item = await MazdoorItem.create({
    name: name.trim(),
    rate: Number(rate) || 0,
    notes: (notes || '').trim(),
  });
  res.status(201).json({ success: true, data: item });
};

export const update = async (req, res) => {
  const { MazdoorItem } = req.models;
  if (req.body.name !== undefined && (!req.body.name || !String(req.body.name).trim())) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }
  const item = await MazdoorItem.findByIdAndUpdate(
    req.params.id,
    {
      name: req.body.name?.trim(),
      rate: req.body.rate !== undefined ? Number(req.body.rate) : undefined,
      notes: (req.body.notes ?? '').toString().trim(),
    },
    { new: true, runValidators: true }
  ).lean();
  if (!item) {
    return res.status(404).json({ success: false, message: 'Mazdoor item not found' });
  }
  res.json({ success: true, data: item });
};

