"""Offline contract behavior tests. GenVM and LLM outputs are stubbed here."""
import importlib.util
import json
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch


def load_contract():
    genlayer = ModuleType("genlayer")
    genlayer.contract = SimpleNamespace(Contract=object)
    genlayer.public = SimpleNamespace(write=lambda fn: fn, view=lambda fn: fn)
    genlayer.message = SimpleNamespace(sender_address=SimpleNamespace(as_hex="0x" + "a" * 40))
    genlayer.nondet = SimpleNamespace(exec_prompt=Mock())
    def prompt_comparative(fn, principle, /):
        return fn()

    genlayer.eq_principle = SimpleNamespace(prompt_comparative=Mock(side_effect=prompt_comparative))
    storage = ModuleType("genlayer.storage")
    storage.TreeMap = dict
    source = Path(__file__).resolve().parents[1] / "contracts" / "scopepulse.py"
    spec = importlib.util.spec_from_file_location("scopepulse", source)
    contract = importlib.util.module_from_spec(spec)
    with patch.dict("sys.modules", {"genlayer": genlayer, "genlayer.storage": storage}):
        spec.loader.exec_module(contract)
    return contract


class ScopePulseTests(unittest.TestCase):
    def setUp(self):
        self.module = load_contract()
        self.contract = self.module.ScopePulse()
        self.contract.assessments = {}
        self.id = "1" * 32
        self.caller = self.module.gl.message.sender_address.as_hex

    def classify(self, original, revised, verdict, rationale):
        evidence = [{"original": original, "revised": revised}]
        self.module.gl.nondet.exec_prompt.return_value = {
            "verdict": verdict, "rationale": rationale, "evidence": evidence,
        }
        self.contract.assess(self.id, original, revised)
        result = json.loads(self.contract.get_assessment(self.caller, self.id))
        self.assertEqual(result, {"verdict": verdict, "rationale": rationale, "evidence": evidence})
        self.module.gl.eq_principle.prompt_comparative.assert_called_once()
        self.assertEqual(self.contract.get_assessment("0x" + "b" * 40, self.id), "")

    def test_compatible(self):
        self.classify("Keep PDF exports.", "Keep PDF exports. Add CSV.", "compatible", "PDF obligation is preserved.")

    def test_potential_conflict(self):
        self.classify("Retain logs for 90 days.", "Delete logs after 30 days.", "potential_conflict", "Retention windows conflict.")

    def test_needs_review(self):
        self.classify("Managers approve refunds.", "Authorized staff approve refunds.", "needs_review", "Authorized roles are undefined.")

    def test_invalid_inputs(self):
        for request_id, original, revised in [("bad", "A", "B"), (self.id, " ", "B"), (self.id, "🟢" * 513, "B")]:
            with self.subTest(request_id=request_id, length=len(original)), self.assertRaises(ValueError):
                self.contract.assess(request_id, original, revised)
        self.module.gl.nondet.exec_prompt.assert_not_called()

    def test_duplicate_request(self):
        self.classify("Keep PDF.", "Keep PDF. Add CSV.", "compatible", "PDF obligation is preserved.")
        with self.assertRaisesRegex(ValueError, "already used"):
            self.contract.assess(self.id, "A", "B")
        self.module.gl.nondet.exec_prompt.assert_called_once()

    def test_rejects_invented_evidence(self):
        self.module.gl.nondet.exec_prompt.return_value = {
            "verdict": "needs_review", "rationale": "Unclear.", "evidence": [{"original": "Invented", "revised": "B"}],
        }
        with self.assertRaisesRegex(ValueError, "exact|quote"):
            self.contract.assess(self.id, "A", "B")
        self.assertEqual(self.contract.assessments, {})
