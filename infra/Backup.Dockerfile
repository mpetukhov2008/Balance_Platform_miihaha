FROM postgres:16-alpine
COPY scripts/backup-postgres.sh /usr/local/bin/balance-backup
RUN chmod 755 /usr/local/bin/balance-backup
ENTRYPOINT ["/usr/local/bin/balance-backup"]
