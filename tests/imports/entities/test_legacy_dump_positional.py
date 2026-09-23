"""Regression: mysqldump without column lists (real S3 dump shape)."""

from __future__ import annotations

from app.imports.entities._legacy_family_common import parse_legacy_country_dial_codes
from app.imports.entities._legacy_family_common import parse_legacy_family_rows
from app.imports.entities._legacy_family_common import parse_legacy_notes
from app.imports.entities._legacy_event_common import parse_legacy_discounts
from app.imports.entities._legacy_event_common import parse_legacy_event_dates
from app.imports.entities._legacy_event_common import parse_legacy_event_labels
from app.imports.entities._legacy_event_common import parse_legacy_events
from app.imports.entities._legacy_event_common import parse_legacy_labels
from app.imports.entities._legacy_event_common import parse_legacy_registrations
from app.imports.entities._legacy_family_common import parse_legacy_person_rows


CREATE_FAMILY = """
CREATE TABLE `family` (
  `id` int NOT NULL,
  `parent_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `address_line1` varchar(255) DEFAULT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `district_id` int DEFAULT NULL,
  `kind` varchar(32) DEFAULT NULL,
  `company_id` int DEFAULT NULL,
  `postal_code` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
"""

# 15 columns: id, parent_id, created_at, created_by, deleted_at, deleted_by,
# name, lat, lng, address_line1, address_line2, district_id, kind, company_id, postal_code
INSERT_DISTRICT = """
INSERT INTO `district` VALUES (3,'Central');
"""

INSERT_FAMILY_POS = """
INSERT INTO `family` VALUES
(47,NULL,'2025-06-02 10:02:31',1,NULL,NULL,'Example Co',22.00000000,114.00000000,'Line1',NULL,3,'company',NULL,NULL);
"""

CREATE_PERSON = """
CREATE TABLE `person` (
  `id` int NOT NULL,
  `family_id` int DEFAULT NULL,
  `kind` varchar(32) DEFAULT NULL,
  `first_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) DEFAULT NULL,
  `email` varchar(320) DEFAULT NULL,
  `instagram_id` varchar(64) DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `phone` varchar(64) DEFAULT NULL,
  `phone_country_code_id` int DEFAULT NULL,
  `occupation` varchar(255) DEFAULT NULL,
  `company` varchar(255) DEFAULT NULL,
  `referral_source` varchar(64) DEFAULT NULL,
  `referral_person_id` int DEFAULT NULL,
  `is_newsletter_subscribed` tinyint DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
"""

INSERT_PERSON_POS = """
INSERT INTO `person` VALUES
(100,47,'parent','Ann','Smith','hello@example.com',NULL,NULL,'98765432',196,NULL,NULL,NULL,NULL,0,NULL);
"""

CREATE_COUNTRY = """
CREATE TABLE `country` (
  `id` int NOT NULL,
  `iso3` char(3) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `region_id` int DEFAULT NULL,
  `dial_code` varchar(16) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
"""

INSERT_COUNTRY_POS = """
INSERT INTO `country` VALUES (196,'HKG','Hong Kong',1,'852');
"""


def test_family_positional_without_insert_column_list() -> None:
    sql = INSERT_DISTRICT + CREATE_FAMILY + INSERT_FAMILY_POS
    rows = parse_legacy_family_rows(sql)
    assert len(rows) == 1
    r = rows[0]
    assert r.legacy_id == 47
    assert r.name == "Example Co"
    assert r.kind == "company"
    assert r.address_line1 == "Line1"
    assert r.latitude == "22.00000000"


def test_person_positional_maps_phone_country_id() -> None:
    sql = CREATE_PERSON + INSERT_PERSON_POS
    rows = parse_legacy_person_rows(sql)
    assert len(rows) == 1
    p = rows[0]
    assert p.legacy_id == 100
    assert p.family_id == 47
    assert p.email == "hello@example.com"
    assert p.phone_country_code_id == 196


def test_country_dial_code_column_not_iso3() -> None:
    sql = CREATE_COUNTRY + INSERT_COUNTRY_POS
    m = parse_legacy_country_dial_codes(sql)
    assert m[196] == "852"


def test_country_dial_codes_with_mysqldump_backslash_escapes() -> None:
    """Real dumps use ``\'`` inside names; extraction must not truncate INSERT."""
    sql = r"""
CREATE TABLE `country` (
  `id` int NOT NULL,
  `iso3` char(3) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `region_id` int DEFAULT NULL,
  `dial_code` varchar(16) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
INSERT INTO `country` VALUES
(384,'CIV','Côte d\'Ivoire',1,'225'),
(196,'HKG','Hong Kong',1,'852');
"""
    m = parse_legacy_country_dial_codes(sql)
    assert m[196] == "852"
    assert m[384] == "225"


CREATE_EVENT = """
CREATE TABLE `event` (
  `id` int NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `description` text,
  `category` varchar(64) DEFAULT NULL,
  `default_price` decimal(10,2) DEFAULT NULL,
  `default_currency` char(3) DEFAULT NULL,
  `default_venue_id` int DEFAULT NULL,
  `organization_id` int DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
"""

INSERT_EVENT_POS = r"""
INSERT INTO `event` VALUES
(1,'Parents\' Workshop','Notes here','workshop',100.00,'HKD',NULL,NULL,NULL);
"""


def test_event_positional_parses_backslash_apostrophe() -> None:
    sql = CREATE_EVENT + INSERT_EVENT_POS
    rows = parse_legacy_events(sql)
    assert len(rows) == 1
    assert rows[0].title == "Parents' Workshop"
    assert rows[0].description == "Notes here"


CREATE_EVENT_DATE = """
CREATE TABLE `event_date` (
  `id` int NOT NULL,
  `event_id` int NOT NULL,
  `starts_at` datetime NOT NULL,
  `ends_at` datetime NOT NULL,
  `venue_id` int DEFAULT NULL,
  `capacity` int DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `notes` text,
  `external_url` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
"""

INSERT_EVENT_DATE_POS = """
INSERT INTO `event_date` VALUES
(10,1,'2025-06-01 10:00:00','2025-06-01 12:00:00',5,20,NULL,NULL,NULL,NULL);
"""


def test_event_date_positional() -> None:
    sql = CREATE_EVENT_DATE + INSERT_EVENT_DATE_POS
    rows = parse_legacy_event_dates(sql)
    assert len(rows) == 1
    assert rows[0].legacy_id == 10
    assert rows[0].event_id == 1


CREATE_REGISTRATION = """
CREATE TABLE `registration` (
  `id` int NOT NULL,
  `event_date_id` int DEFAULT NULL,
  `person_id` int DEFAULT NULL,
  `family_id` int DEFAULT NULL,
  `organization_id` int DEFAULT NULL,
  `status` varchar(32) DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `currency` char(3) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `notes` text,
  `deleted_at` datetime DEFAULT NULL,
  `discount_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
"""

INSERT_REGISTRATION_POS = r"""
INSERT INTO `registration` VALUES
(99,10,1,NULL,NULL,'paid',50.00,'HKD',NULL,NULL,'Can\'t attend follow up; ok',NULL,NULL,'2020-01-01 00:00:00');
"""


def test_registration_positional_backslash_in_notes() -> None:
    sql = CREATE_REGISTRATION + INSERT_REGISTRATION_POS
    rows = parse_legacy_registrations(sql)
    assert len(rows) == 1
    assert rows[0].notes == "Can't attend follow up; ok"


CREATE_DISCOUNT = """
CREATE TABLE `discount` (
  `id` int NOT NULL,
  `code` varchar(50) DEFAULT NULL,
  `type` varchar(32) DEFAULT NULL,
  `value` decimal(10,2) DEFAULT NULL,
  `valid_from` datetime DEFAULT NULL,
  `valid_to` datetime DEFAULT NULL,
  `max_uses` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `event_date_id` int DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
"""

INSERT_DISCOUNT_POS = r"""
INSERT INTO `discount` VALUES
(5,'SAVE10','percentage',10.00,NULL,NULL,NULL,1,NULL,NULL);
"""


def test_discount_positional() -> None:
    sql = CREATE_DISCOUNT + INSERT_DISCOUNT_POS
    rows = parse_legacy_discounts(sql)
    assert len(rows) == 1
    assert rows[0].code == "SAVE10"


INSERT_EVENT_AUDIT_ONLY = """
INSERT INTO `event` VALUES
(1,NULL,'2025-06-01 10:00:00',1,NULL,NULL,
 'Workshop','desc text','workshop',100.00,'HKD',5,7,NULL);
"""


def test_event_positional_audit_shape_without_create_table() -> None:
    rows = parse_legacy_events(INSERT_EVENT_AUDIT_ONLY)
    assert len(rows) == 1
    assert rows[0].title == "Workshop"
    assert rows[0].default_venue_id == 5
    assert rows[0].organization_id == 7


INSERT_EVENT_DATE_AUDIT_ONLY = """
INSERT INTO `event_date` VALUES
(10,NULL,'2025-06-01 10:00:00',1,NULL,NULL,
 77,'2025-06-01 10:00:00','2025-06-01 12:00:00',5,20,NULL,NULL,NULL,NULL);
"""


def test_event_date_positional_audit_shape_without_create_table() -> None:
    rows = parse_legacy_event_dates(INSERT_EVENT_DATE_AUDIT_ONLY)
    assert len(rows) == 1
    assert rows[0].legacy_id == 10
    assert rows[0].event_id == 77
    assert rows[0].venue_id == 5


INSERT_REGISTRATION_AUDIT_ONLY = """
INSERT INTO `registration` VALUES
(99,NULL,'2025-06-01 10:00:00',1,NULL,NULL,
 10,1,NULL,NULL,'paid',50.00,'HKD',NULL,NULL,'note',NULL,NULL,'2020-01-01 00:00:00');
"""


def test_registration_positional_audit_shape_without_create_table() -> None:
    rows = parse_legacy_registrations(INSERT_REGISTRATION_AUDIT_ONLY)
    assert len(rows) == 1
    assert rows[0].legacy_id == 99
    assert rows[0].event_date_id == 10
    assert rows[0].status == "paid"


INSERT_DISCOUNT_AUDIT_ONLY = """
INSERT INTO `discount` VALUES
(5,NULL,'2025-06-01 10:00:00',1,NULL,NULL,
 'SAVE10','percentage',10.00,NULL,NULL,NULL,1,NULL,NULL);
"""


def test_discount_positional_audit_shape_without_create_table() -> None:
    rows = parse_legacy_discounts(INSERT_DISCOUNT_AUDIT_ONLY)
    assert len(rows) == 1
    assert rows[0].legacy_id == 5
    assert rows[0].code == "SAVE10"


INSERT_EVENT_LABEL_EVENT_FIRST = """
INSERT INTO `event_label` VALUES (3, 9);
"""


def test_event_label_positional_event_id_first_without_create() -> None:
    rows = parse_legacy_event_labels(INSERT_EVENT_LABEL_EVENT_FIRST)
    assert len(rows) == 1
    assert rows[0].event_id == 3
    assert rows[0].event_date_id is None
    assert rows[0].label_id == 9


CREATE_EVENT_LABEL_DATE_FIRST = """
CREATE TABLE `event_label` (
  `event_date_id` int NOT NULL,
  `label_id` int NOT NULL,
  PRIMARY KEY (`event_date_id`,`label_id`)
) ENGINE=InnoDB;
INSERT INTO `event_label` VALUES (8, 2);
"""


def test_event_label_create_table_date_id_first() -> None:
    rows = parse_legacy_event_labels(CREATE_EVENT_LABEL_DATE_FIRST)
    assert len(rows) == 1
    assert rows[0].event_date_id == 8
    assert rows[0].event_id is None


INSERT_LABEL_AUDIT_ONLY = """
INSERT INTO `label` VALUES
(100,NULL,'2020-01-01 00:00:00',1,NULL,NULL,'MyTag','status');
"""


def test_label_positional_audit_shape_without_create_table() -> None:
    rows = parse_legacy_labels(INSERT_LABEL_AUDIT_ONLY)
    assert len(rows) == 1
    assert rows[0].legacy_id == 100
    assert rows[0].name == "MyTag"
    assert rows[0].entity == "status"


def test_note_content_with_semicolon_in_string() -> None:
    sql = """
CREATE TABLE `note` (
  `id` int NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `took_at` datetime NOT NULL,
  `content` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
INSERT INTO `note` VALUES (9,'2020-01-01 00:00:00','2020-01-02 00:00:00','Call back; urgent');
"""
    notes = parse_legacy_notes(sql)
    assert len(notes) == 1
    assert notes[0].content == "Call back; urgent"
