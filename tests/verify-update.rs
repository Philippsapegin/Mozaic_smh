use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let key = String::from_utf8(STANDARD.decode(std::fs::read_to_string(&args[1]).unwrap().trim()).unwrap()).unwrap();
    let signature = String::from_utf8(STANDARD.decode(std::fs::read_to_string(&args[2]).unwrap().trim()).unwrap()).unwrap();
    let public_key = PublicKey::decode(&key).unwrap();
    let signature = Signature::decode(&signature).unwrap();
    let mut payload = std::fs::read(&args[3]).unwrap();
    public_key.verify(&payload, &signature, true).expect("The released installer signature is invalid");
    payload[0] ^= 1;
    assert!(public_key.verify(&payload, &signature, true).is_err(), "A changed installer passed verification");
    println!("Released installer signature verified; tampered installer rejected.");
}
