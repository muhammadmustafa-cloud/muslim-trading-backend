

export const list = async (req, res) => {
  try {
    const { RawMaterialHead } = req.models;
    let heads = await RawMaterialHead.find().sort({ name: 1 });
    
    // Auto-populate default items if none exist
    if (heads.length === 0) {
      const defaults = [
        { name: 'Bardana (Bags)' },
        { name: 'Mitti' },
        { name: 'Munshiana' }
      ];
      await RawMaterialHead.insertMany(defaults);
      heads = await RawMaterialHead.find().sort({ name: 1 });
    }
    
    res.json({ success: true, data: heads });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const create = async (req, res) => {
  try {
    const { RawMaterialHead } = req.models;
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name required' });
    
    const head = await RawMaterialHead.create({ name });
    res.status(201).json({ success: true, data: head });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const update = async (req, res) => {
  try {
    const { RawMaterialHead } = req.models;
    const head = await RawMaterialHead.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: head });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const remove = async (req, res) => {
  try {
    const { RawMaterialHead } = req.models;
    await RawMaterialHead.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
