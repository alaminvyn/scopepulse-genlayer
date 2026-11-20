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
        self.contract.clause_assessments = {}
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

    def test_clause_verdicts_and_retrieval(self):
        for index, (requirement, verdict) in enumerate([
            ("Delete all audit logs after 30 days.", "violates"),
            ("Retain audit logs for 120 days before deletion.", "satisfies"),
            ("Archive audit logs according to the standard retention schedule.", "unclear"),
        ]):
            with self.subTest(verdict=verdict):
                request_id = f"{index:032x}"
                clause = "Audit logs must be retained for at least 90 days."
                result = {"verdict": verdict, "rationale": "The retention commitment determines the outcome.",
                          "evidence": {"clause": clause, "requirement": requirement}}
                self.module.gl.nondet.exec_prompt.return_value = result
                self.contract.assess_clause(request_id, clause, requirement)
                self.assertEqual(json.loads(self.contract.get_clause_assessment(self.caller.upper(), request_id)), result)
                self.assertEqual(self.contract.get_assessment(self.caller, request_id), "")

    def test_rejects_invalid_clause_inputs_without_model_execution(self):
        for args in [("bad", "A", "B"), (self.id, "", "B"), (self.id, "A", " "),
                     (self.id, "🟢" * 513, "B"), (self.id, "A", "x" * 2049)]:
            with self.subTest(request_id=args[0], lengths=list(map(len, args))), self.assertRaises(ValueError):
                self.contract.assess_clause(*args)
        self.module.gl.nondet.exec_prompt.assert_not_called()

    def test_rejects_invalid_clause_output(self):
        valid = {"verdict": "unclear", "rationale": "The schedule is unspecified.",
                 "evidence": {"clause": "Policy", "requirement": "Schedule"}}
        for result in [
            "{invalid",
            [("verdict", "unclear")],
            {**valid, "extra": True},
            {**valid, "verdict": "compatible"},
            {**valid, "rationale": " "},
            {**valid, "rationale": "x" * 421},
            {**valid, "evidence": {"clause": "Schedule", "requirement": "Policy"}},
            {**valid, "evidence": {"clause": "Policy", "requirement": "Invented"}},
            {**valid, "evidence": {"clause": "Policy"}},
        ]:
            with self.subTest(result=result), self.assertRaises(ValueError):
                self.module.gl.nondet.exec_prompt.return_value = result
                self.contract.assess_clause(self.id, "Policy", "Schedule")
        self.assertEqual(self.contract.get_clause_assessment(self.caller, self.id), "")

    def test_clause_namespace_duplicate_and_caller_isolation(self):
        self.assertEqual(self.contract.get_clause_assessment(self.caller, self.id), "")
        self.classify("Keep PDF.", "Keep PDF. Add CSV.", "compatible", "PDF remains.")
        self.module.gl.nondet.exec_prompt.return_value = {
            "verdict": "unclear", "rationale": "No duration.",
            "evidence": {"clause": "Policy", "requirement": "Schedule"},
        }
        self.contract.assess_clause(self.id, "Policy", "Schedule")
        with self.assertRaisesRegex(ValueError, "already used"):
            self.contract.assess_clause(self.id, "Policy", "Schedule")
        self.assertEqual(self.module.gl.nondet.exec_prompt.call_count, 2)
        other = "0x" + "b" * 40
        self.assertEqual(self.contract.get_clause_assessment(other, self.id), "")
        self.module.gl.message.sender_address.as_hex = other
        self.contract.assess_clause(self.id, "Policy", "Schedule")
        self.assertTrue(self.contract.get_clause_assessment(other, self.id))
        self.assertEqual(json.loads(self.contract.get_assessment(self.caller, self.id))["verdict"], "compatible")

    def test_clause_consensus_uses_stable_result_and_checks_decisive_obligation(self):
        result = {"verdict": "unclear", "rationale": "No schedule is specified.",
                  "evidence": {"clause": "Policy", "requirement": "Schedule"}}
        model = self.module.gl.nondet.exec_prompt
        model.side_effect = [result, dict(reversed(list(result.items())))]

        def compare(evaluate, principle, /):
            self.assertIn("verdict must match exactly", principle)
            self.assertIn("same decisive policy obligation", principle)
            leader = evaluate()
            self.assertEqual(leader, evaluate())
            return leader

        self.module.gl.eq_principle.prompt_comparative.side_effect = compare
        self.contract.assess_clause(self.id, "Policy", "Schedule")
        self.assertEqual(model.call_count, 2)

    def test_clause_revalidates_consensus_result_before_storing(self):
        self.module.gl.eq_principle.prompt_comparative.side_effect = None
        self.module.gl.eq_principle.prompt_comparative.return_value = json.dumps({
            "verdict": "satisfies", "rationale": "Unsupported.",
            "evidence": {"clause": "Invented", "requirement": "Schedule"},
        })
        with self.assertRaisesRegex(ValueError, "quote"):
            self.contract.assess_clause(self.id, "Policy", "Schedule")
        self.assertEqual(self.contract.get_clause_assessment(self.caller, self.id), "")
