"""Guards the CI -> Pages deployment handoff so it cannot silently regress.

These tests assert the *configuration* of the deployment workflow (trigger and
gating logic), not runtime behaviour: automatic deploys must only happen after a
successful CI run on main, deploy the exact tested commit, and keep manual
dispatch working. They do not change any game rule or engine behaviour.
"""

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
DEPLOY = yaml.safe_load((REPO_ROOT / ".github/workflows/deploy-pages.yml").read_text(encoding="utf-8"))
DEPLOY_TEXT = (REPO_ROOT / ".github/workflows/deploy-pages.yml").read_text(encoding="utf-8")
# PyYAML parses the bare `on:` key as the boolean True.
ON = DEPLOY.get("on", DEPLOY.get(True))


def test_deploy_triggers_on_ci_completion_and_manual_dispatch():
    assert "workflow_dispatch" in ON
    assert ON["workflow_run"]["workflows"] == ["CI"]
    assert ON["workflow_run"]["types"] == ["completed"]


def test_manual_dispatch_still_accepts_base_path_defaulting_to_project_site():
    base = ON["workflow_dispatch"]["inputs"]["base_path"]
    assert base["default"] == "/Assalto-Reale/"
    assert base["required"] is True


def test_build_only_runs_for_successful_ci_on_main_or_manual_dispatch():
    condition = DEPLOY["jobs"]["build"]["if"]
    assert "workflow_dispatch" in condition
    assert "workflow_run.conclusion == 'success'" in condition
    assert "workflow_run.head_branch == 'main'" in condition


def test_deploy_checks_out_the_tested_commit_not_a_later_one():
    # The tested head SHA is used for checkout, the metadata and the build.
    assert "github.event.workflow_run.head_sha || github.sha" in DEPLOY_TEXT
    assert "SOURCE_COMMIT" in DEPLOY_TEXT


def test_workflow_keeps_minimal_permissions_concurrency_and_environment():
    assert DEPLOY["permissions"] == {"contents": "read", "pages": "write", "id-token": "write"}
    assert DEPLOY["concurrency"]["group"] == "pages"
    assert DEPLOY["jobs"]["deploy"]["environment"]["name"] == "github-pages"


def test_post_deploy_verification_job_exists_and_checks_metadata_commit():
    verify = DEPLOY["jobs"]["verify"]
    assert "deploy" in verify["needs"] and "build" in verify["needs"]
    step = verify["steps"][0]["run"]
    assert "release-metadata.json" in step
    assert "pythons" in step and "Pygbag" in step  # verifies the legacy Pygbag loader is absent
    assert "$EXPECTED" in step  # matches the deployed commit against the tested one


def test_ci_workflow_installs_python_dependencies_before_pytest():
    ci = yaml.safe_load((REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"))
    steps = ci["jobs"]["python-tests"]["steps"]
    joined = " ".join(str(s.get("run", "")) for s in steps)
    assert "requirements-dev.txt" in joined
