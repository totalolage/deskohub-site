FROM postgres:18.4

ARG PG_UUIDV7_VERSION=1.7.0
ARG PG_UUIDV7_SHA256=9364ca01246dbf792de9ed50ffbe502d49e8c28e659f4e7073d4225096b15965

RUN set -eux; \
    test "$(pg_config --version)" = "PostgreSQL 18.4"; \
    curl --fail --location --silent --show-error \
      --output /tmp/pg_uuidv7.tar.gz \
      "https://github.com/fboulnois/pg_uuidv7/releases/download/v${PG_UUIDV7_VERSION}/pg_uuidv7.tar.gz"; \
    echo "${PG_UUIDV7_SHA256}  /tmp/pg_uuidv7.tar.gz" | sha256sum --check --strict; \
    tar --extract --gzip --file /tmp/pg_uuidv7.tar.gz --directory /tmp; \
    install --mode=755 /tmp/18/pg_uuidv7.so "$(pg_config --pkglibdir)/pg_uuidv7.so"; \
    install --mode=644 /tmp/pg_uuidv7--1.7.sql /tmp/pg_uuidv7.control "$(pg_config --sharedir)/extension/"; \
    rm --recursive --force /tmp/18 /tmp/pg_uuidv7.tar.gz /tmp/pg_uuidv7--1.7.sql /tmp/pg_uuidv7.control
