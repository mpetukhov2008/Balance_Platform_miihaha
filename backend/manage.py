import argparse
import getpass
import secrets
from pathlib import Path
from backend.store import Store, uid
from backend.api import password_hash

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-user"])
    parser.add_argument("username")
    args = parser.parse_args()
    password = getpass.getpass("Password (min 10 characters): ")
    if len(password) < 10:
        parser.error("Password must contain at least 10 characters")
    store = Store()
    if any(u["username"] == args.username for u in store.all("user", None)):
        parser.error("User already exists")
    salt = secrets.token_hex(16)
    store.put("user", "system", {"id":uid(),"username":args.username,"salt":salt,"passwordHash":password_hash(password,salt)})
    print("User created")

if __name__ == "__main__":
    main()
