"""CloudFormation custom resource: upsert SES email templates from code."""

from __future__ import annotations

from typing import Any, Mapping

from botocore.exceptions import ClientError

from app.services.aws_clients import get_ses_client
from app.templates.ses.booking_confirmation import (
    get_ses_template_definitions as booking_templates,
)
from app.templates.ses.intro_call_confirmation import (
    get_ses_template_definitions as intro_call_templates,
)
from app.templates.ses.contact_confirmation import (
    get_ses_template_definitions as contact_templates,
)
from app.templates.ses.invoice_email import (
    get_ses_template_definitions as invoice_templates,
)
from app.templates.ses.media_download_link import (
    get_ses_template_definitions as media_templates,
)
from app.utils.cfn_response import send_cfn_response
from app.utils.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Create, update, or delete SES templates based on bundled definitions."""
    request_type = str(event.get("RequestType", ""))
    physical_id = str(event.get("PhysicalResourceId") or "ses-templates")

    all_defs = (
        contact_templates()
        + media_templates()
        + booking_templates()
        + intro_call_templates()
        + invoice_templates()
    )
    names = [t["TemplateName"] for t in all_defs]

    if request_type == "Delete":
        logger.info(
            "Skipping SES template deletion (templates are retained for reuse)",
            extra={"templates": ",".join(names)},
        )
        data = {"templates": ",".join(names)}
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}

    try:
        client = get_ses_client()
        for tpl in all_defs:
            name = tpl["TemplateName"]
            payload = {
                "TemplateName": name,
                "SubjectPart": tpl["SubjectPart"],
                "HtmlPart": tpl["HtmlPart"],
                "TextPart": tpl["TextPart"],
            }
            try:
                client.create_template(Template=payload)
                logger.info("SES template created", extra={"template": name})
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code == "AlreadyExists":
                    client.update_template(Template=payload)
                    logger.info("SES template updated", extra={"template": name})
                else:
                    raise

        data = {"templates": ",".join(names)}
        physical_id = str(event.get("PhysicalResourceId") or "ses-templates")
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}
    except Exception:
        logger.exception("SES template manager failed")
        send_cfn_response(
            event,
            context,
            "FAILED",
            {"templates": ""},
            physical_id,
            "SES template manager failed",
        )
        return {"PhysicalResourceId": physical_id, "Data": {"templates": ""}}
