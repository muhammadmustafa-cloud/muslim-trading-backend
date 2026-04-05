export const getMigrationEntities = async (req, res) => {
  try {
    const { Customer, Supplier, Mazdoor, Item, Account } = req.models;
    
    if (!Customer) {
      return res.status(500).json({ success: false, message: "Models not initialized correctly for this tenant" });
    }

    const [customers, suppliers, mazdoors, items, accounts] = await Promise.all([
      Customer.find({}).sort({ name: 1 }).lean(),
      Supplier.find({}).sort({ name: 1 }).lean(),
      Mazdoor.find({}).sort({ name: 1 }).lean(),
      Item.find({}).sort({ name: 1 }).lean(),
      Account.find({}).sort({ name: 1 }).lean(),
    ]);

    res.json({
      success: true,
      data: {
        customers,
        suppliers,
        mazdoors,
        items,
        accounts
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEntityOpening = async (req, res) => {
  try {
    const { Customer, Supplier, Mazdoor, Item, Account } = req.models;
    const { entityType, id, fields } = req.body;
    let model;
    
    switch (entityType) {
      case 'customer': model = Customer; break;
      case 'supplier': model = Supplier; break;
      case 'mazdoor': model = Mazdoor; break;
      case 'item': model = Item; break;
      case 'account': model = Account; break;
      default: return res.status(400).json({ success: false, message: 'Invalid entity type' });
    }

    if (!model) {
      return res.status(500).json({ success: false, message: `Model ${entityType} not found` });
    }

    const updated = await model.findByIdAndUpdate(id, { $set: fields }, { new: true });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
