# MMDB fixture

`GeoIP2-ISP-Test.mmdb` is the MaxMind test database from [MaxMind-DB commit c454a21](https://github.com/maxmind/MaxMind-DB/blob/c454a21f31fd17f2843f16094e9afb3a14a42078/test-data/GeoIP2-ISP-Test.mmdb), distributed under the accompanying [Apache 2.0 license](LICENSE.txt). It exceeds the production downloader's 64 KiB minimum and contains synthetic ISP records. Tests use this database to verify format acceptance and atomic replacement without downloading a live database.
