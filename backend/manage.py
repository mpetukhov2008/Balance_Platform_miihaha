import argparse
import getpass
from backend.store import Store
from backend.api import create_user

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
    try:
        create_user(store, args.username, password)
    except ValueError:
        parser.error('User already exists')
    print("User created")

if __name__ == "__main__":
    main()
