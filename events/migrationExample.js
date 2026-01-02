migrate((app) => {
    let superusers = app.findCollectionByNameOrId('_superusers');

    let record = new Record(superusers);

    // note: the values can be eventually loaded via $os.getenv(key)
    // or from a special local config file
    record.set('email', 'test@example.com');
    record.set('password', '1234567890');

    app.save(record);
});
