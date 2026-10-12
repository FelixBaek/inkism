//! Separate-process attachment I/O: never takes the foreground note engine lock.
use inkism_runtime::local_key;
use std::io::{self, Write};
use std::path::Path;

pub fn run(
    db: &str,
    operation: &str,
    id: &str,
    name: &str,
    media_type: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let _lease = inkism_runtime::library_lock::LibraryLease::shared(db)?;
    let path = format!("{db}.attachments");
    let mut store = local_key::load(db)?.attachments(Path::new(&path))?;
    match operation {
        "list" => {
            let mut output = io::BufWriter::new(io::stdout().lock());
            store.for_each_metadata(|metadata| {
                serde_json::to_writer(&mut output, &metadata)?;
                writeln!(output)?;
                Ok(())
            })?;
            output.flush()?;
        }
        "import" => {
            let metadata = store.import_reader(name, media_type, io::stdin().lock())?;
            println!("{}", serde_json::to_string(&metadata)?);
        }
        "info" => println!("{}", serde_json::to_string(&store.metadata(id)?)?),
        "export" => {
            let mut output = io::BufWriter::new(io::stdout().lock());
            store.copy_to(id, &mut output)?;
            output.flush()?;
        }
        _ => return Err("unknown attachment operation".into()),
    }
    Ok(())
}
