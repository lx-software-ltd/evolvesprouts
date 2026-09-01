from __future__ import annotations

import pytest

from app.api.admin_validators import (
    parse_optional_instagram_handle,
    parse_optional_service_instance_slug,
    parse_optional_service_instance_slug_like_text,
    validate_email,
    validate_string_length,
)
from app.exceptions import ValidationError


def test_validate_string_length_rejects_missing_required_values() -> None:
    with pytest.raises(ValidationError, match="title is required"):
        validate_string_length(None, "title", max_length=10, required=True)


def test_validate_string_length_rejects_values_over_max_length() -> None:
    with pytest.raises(ValidationError, match="title must be at most 5 characters"):
        validate_string_length("toolong", "title", max_length=5)


def test_validate_email_normalizes_case() -> None:
    assert validate_email("ADMIN@EXAMPLE.COM") == "admin@example.com"


def test_parse_optional_service_instance_slug_normalizes_and_validates() -> None:
    assert (
        parse_optional_service_instance_slug("  Spring-Workshop  ") == "spring-workshop"
    )
    assert parse_optional_service_instance_slug(None) is None
    assert parse_optional_service_instance_slug("   ") is None


def test_parse_optional_service_instance_slug_rejects_invalid() -> None:
    with pytest.raises(ValidationError, match="lowercase letters"):
        parse_optional_service_instance_slug("Bad_Slug")
    with pytest.raises(ValidationError, match="lowercase letters"):
        parse_optional_service_instance_slug("double--hyphen")


def test_parse_optional_service_instance_slug_like_text_matches_slug_rules() -> None:
    assert (
        parse_optional_service_instance_slug_like_text(
            "  Spring-Cohort  ", field="cohort"
        )
        == "spring-cohort"
    )
    assert parse_optional_service_instance_slug_like_text(None, field="cohort") is None
    assert parse_optional_service_instance_slug_like_text("   ", field="cohort") is None


def test_parse_optional_service_instance_slug_like_text_sets_field_on_error() -> None:
    with pytest.raises(ValidationError, match="lowercase letters") as excinfo:
        parse_optional_service_instance_slug_like_text("Bad_Slug", field="cohort")
    assert excinfo.value.field == "cohort"
    with pytest.raises(ValidationError, match="lowercase letters") as excinfo2:
        parse_optional_service_instance_slug_like_text("a--b", field="cohort")
    assert excinfo2.value.field == "cohort"


def test_parse_optional_instagram_handle_strips_at_and_lowercases() -> None:
    assert parse_optional_instagram_handle(" @Kitie.W ") == "kitie.w"
    assert parse_optional_instagram_handle("kitie.w") == "kitie.w"
    assert parse_optional_instagram_handle(" @ ") is None
    assert parse_optional_instagram_handle(None) is None


def test_parse_optional_instagram_handle_rejects_over_thirty() -> None:
    with pytest.raises(ValidationError, match="at most 30"):
        parse_optional_instagram_handle("@" + ("a" * 31))
