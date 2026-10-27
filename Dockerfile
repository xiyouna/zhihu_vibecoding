# Ubuntu 24.04 tool image.
#
# Do not delete /etc/apt/sources.list.d/ubuntu.sources or rewrite
# sources to http://mirrors.cloud.tencent.com/ubuntu. That pattern
# fails Docker builds with apt-get exit 100:
#   - Ubuntu 24.04 (noble) uses deb822 ubuntu.sources with Signed-By
#   - the Tencent Cloud host 302-redirects HTTP to HTTPS
#   - it often prefers IPv6, which many CI / Cloud Agent builders lack
#   - that hostname is also slow or unreachable outside Tencent Cloud
# Keep official Ubuntu archives first; fall back to a public HTTPS
# mirror without dropping the signed-by keyring.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN set -eux; \
    printf '%s\n' \
        'Acquire::Retries "5";' \
        'Acquire::http::Timeout "20";' \
        'Acquire::https::Timeout "20";' \
        'Acquire::ForceIPv4 "true";' \
        > /etc/apt/apt.conf.d/99build-retries; \
    if ! apt-get update; then \
        echo 'official Ubuntu archives failed; falling back to Aliyun HTTPS mirror'; \
        sed -i \
            -e 's|http://archive.ubuntu.com/ubuntu|https://mirrors.aliyun.com/ubuntu|g' \
            -e 's|http://security.ubuntu.com/ubuntu|https://mirrors.aliyun.com/ubuntu|g' \
            /etc/apt/sources.list.d/ubuntu.sources; \
        apt-get update; \
    fi; \
    apt-get install -y --no-install-recommends \
        bash \
        bzip2 \
        ca-certificates \
        coreutils \
        curl \
        default-mysql-client \
        findutils \
        git \
        git-lfs \
        groff-base \
        gzip \
        jq \
        less \
        openssh-client \
        openssl \
        perl \
        tar \
        unzip \
        wget \
        xz-utils \
        zip; \
    git lfs install --system; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

USER ubuntu
WORKDIR /workspace
