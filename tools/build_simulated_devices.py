#!/usr/bin/env python3
"""Build registrations and declarations for the simulated PPD participants.

    python3 tools/build_simulated_devices.py

For each `simulated` device in server/config/devices.json this reads its research fixture
(public/mock/devices/<fixture>.json) and writes, to simulated/:

    <device_id>.registration.json   Device Registration Object
    <device_id>.declaration.json    Device Declaration Object (draft-dsmullen-ppd-protocol-04 section 7.7)

The declaration has one statement per source-linked fixture flow, in core ppd: terms only, so it needs
no taxonomy prefixes. The habanero-ppd-clients host stub sends them to the gateway (see
tools/run_simulated_devices.sh). app-api matches each statement_id back to the fixture flow to show the
researched wording.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
REGISTRY = os.path.join(ROOT, "server", "config", "devices.json")
FIXTURES = os.path.join(ROOT, "public", "mock", "devices")
OUT = os.path.join(ROOT, "simulated")
FIELDS = ("data_type", "purpose", "action", "source", "handling_context")


def main():
    registry = json.load(open(REGISTRY))["devices"]
    os.makedirs(OUT, exist_ok=True)
    for entry in registry:
        if entry.get("kind") != "simulated":
            continue
        device_id, fixture_id = entry["device_id"], entry["fixture"]
        fixture = json.load(open(os.path.join(FIXTURES, fixture_id + ".json")))
        statements = []
        for flow in fixture["flows"]:
            if flow["evidence"] != "source_linked":
                continue
            statement = {"statement_id": flow["id"].split(".", 1)[1]}
            statement.update({k: flow["taxonomy"][k] for k in FIELDS})
            assert all(statement[k].startswith("ppd:") for k in FIELDS), flow["id"]
            if flow["taxonomy"]["constraints"]:
                statement["constraints"] = flow["taxonomy"]["constraints"]
            statements.append(statement)

        vendor = fixture["name"].split(" ")[0]
        registration = {
            "device_id": device_id,
            "manufacturer": vendor,
            "model": fixture["name"],
            "firmware_version": "simulated-1",
            "hostname": device_id,
        }
        declaration = {
            "device_id": device_id,
            "declaration_id": fixture["declaration_id_example"] + "-declaration",
            "taxonomy": {"release": "ppd-core-2026-05"},
            "statements": statements,
        }
        for suffix, doc in (("registration", registration), ("declaration", declaration)):
            path = os.path.join(OUT, "%s.%s.json" % (device_id, suffix))
            with open(path, "w") as f:
                json.dump(doc, f, indent=2)
                f.write("\n")
        print("wrote %s: %d statements from %s" % (device_id, len(statements), fixture_id))


main()
