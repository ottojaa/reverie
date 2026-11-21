# Postgres with pgvector, still on Alpine/musl.
#
# Not the Debian pgvector/pgvector image: the production data directory was created under musl, and opening it
# with glibc changes collation order and silently corrupts text indexes.
#
# The base tag is pinned to an exact minor so a rebuild cannot move the server version under existing data.
ARG POSTGRES_IMAGE=postgres:16.16-alpine3.24

FROM ${POSTGRES_IMAGE} AS build
ARG PGVECTOR_VERSION=0.8.1
ARG PGVECTOR_SHA256=a9094dfb85ccdde3cbb295f1086d4c71a20db1d26bf1d6c39f07a7d164033eb4
RUN apk add --no-cache --virtual .build-deps build-base curl
RUN curl -fsSL -o pgvector.tar.gz "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" \
    && echo "${PGVECTOR_SHA256}  pgvector.tar.gz" | sha256sum -c - \
    && tar -xzf pgvector.tar.gz \
    && cd "pgvector-${PGVECTOR_VERSION}" \
    # with_llvm=no: the server is built with LLVM JIT but the build stage has no clang; JIT bitcode is not needed.
    # OPTFLAGS="": drop -march=native so the image runs on any x86-64 / arm64 host, not just the build machine.
    && make with_llvm=no OPTFLAGS="" \
    && make with_llvm=no OPTFLAGS="" install DESTDIR=/out

FROM ${POSTGRES_IMAGE}
COPY --from=build /out/usr/local/ /usr/local/
