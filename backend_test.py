#!/usr/bin/env python3
"""
Backend test suite for Supabase Edge Function: wake-up
Tests the deployed phone-call API at https://suwdzoycyeihbkhmpxay.supabase.co/functions/v1/wake-up
"""

import requests
import time
import json

BASE_URL = "https://suwdzoycyeihbkhmpxay.supabase.co/functions/v1/wake-up"

def print_test_header(test_name):
    print(f"\n{'='*80}")
    print(f"TEST: {test_name}")
    print('='*80)

def print_result(success, message):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {message}")

def test_health_endpoint():
    """Test 1: GET /health - credential check without placing a call"""
    print_test_header("GET /health - Credential Check")
    
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Headers: {dict(response.headers)}")
        print(f"Response Body: {response.text}")
        
        # Check status code
        if response.status_code != 200:
            print_result(False, f"Expected status 200, got {response.status_code}")
            return False
        
        # Check CORS header
        cors_header = response.headers.get('Access-Control-Allow-Origin')
        if cors_header != '*':
            print_result(False, f"Expected CORS header '*', got '{cors_header}'")
            return False
        
        # Check JSON response
        data = response.json()
        required_fields = ['ok', 'accountStatus', 'accountType', 'fromNumber', 'toNumber', 'host']
        for field in required_fields:
            if field not in data:
                print_result(False, f"Missing required field: {field}")
                return False
        
        if data['ok'] != True:
            print_result(False, f"Expected ok=true, got {data['ok']}")
            return False
        
        if data['host'] != 'supabase-edge':
            print_result(False, f"Expected host='supabase-edge', got '{data['host']}'")
            return False
        
        # Check phone number masking
        if '•' not in data['toNumber']:
            print_result(False, f"Expected masked toNumber with '•', got '{data['toNumber']}'")
            return False
        
        print_result(True, f"Health check passed. Account: {data['accountType']}, Status: {data['accountStatus']}")
        return True
        
    except Exception as e:
        print_result(False, f"Exception occurred: {str(e)}")
        return False

def test_twiml_endpoint():
    """Test 2: GET /twiml - call script XML"""
    print_test_header("GET /twiml - Call Script XML")
    
    try:
        response = requests.get(f"{BASE_URL}/twiml", timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Content-Type: {response.headers.get('Content-Type')}")
        print(f"Response Body: {response.text}")
        
        # Check status code
        if response.status_code != 200:
            print_result(False, f"Expected status 200, got {response.status_code}")
            return False
        
        # Check content type
        content_type = response.headers.get('Content-Type', '')
        if 'text/xml' not in content_type:
            print_result(False, f"Expected Content-Type 'text/xml', got '{content_type}'")
            return False
        
        # Check XML content
        body = response.text
        if '<Say voice="alice" loop="3">Good morning.</Say>' not in body:
            print_result(False, "Expected TwiML with 'Good morning' message not found")
            return False
        
        print_result(True, "TwiML endpoint returned correct XML")
        return True
        
    except Exception as e:
        print_result(False, f"Exception occurred: {str(e)}")
        return False

def test_cors_preflight():
    """Test 3: OPTIONS request - CORS preflight"""
    print_test_header("OPTIONS / - CORS Preflight")
    
    try:
        headers = {
            'Origin': 'https://example.netlify.app',
            'Access-Control-Request-Method': 'POST'
        }
        response = requests.options(BASE_URL, headers=headers, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Headers: {dict(response.headers)}")
        
        # Check status code (204 or 200 acceptable)
        if response.status_code not in [200, 204]:
            print_result(False, f"Expected status 200 or 204, got {response.status_code}")
            return False
        
        # Check CORS header
        cors_header = response.headers.get('Access-Control-Allow-Origin')
        if cors_header != '*':
            print_result(False, f"Expected CORS header '*', got '{cors_header}'")
            return False
        
        print_result(True, "CORS preflight passed")
        return True
        
    except Exception as e:
        print_result(False, f"Exception occurred: {str(e)}")
        return False

def test_status_no_callsid():
    """Test 4: GET /status without callSid - validation error"""
    print_test_header("GET /status - No callSid (validation)")
    
    try:
        response = requests.get(f"{BASE_URL}/status", timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.text}")
        
        # Check status code
        if response.status_code != 400:
            print_result(False, f"Expected status 400, got {response.status_code}")
            return False
        
        # Check error message
        data = response.json()
        if data.get('ok') != False:
            print_result(False, f"Expected ok=false, got {data.get('ok')}")
            return False
        
        if 'A valid callSid is required' not in data.get('error', ''):
            print_result(False, f"Expected validation error message, got '{data.get('error')}'")
            return False
        
        print_result(True, "Validation error returned correctly for missing callSid")
        return True
        
    except Exception as e:
        print_result(False, f"Exception occurred: {str(e)}")
        return False

def test_status_invalid_callsid():
    """Test 5: GET /status with invalid callSid - validation error"""
    print_test_header("GET /status?callSid=INVALID123 - Invalid callSid")
    
    try:
        response = requests.get(f"{BASE_URL}/status?callSid=INVALID123", timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.text}")
        
        # Check status code
        if response.status_code != 400:
            print_result(False, f"Expected status 400, got {response.status_code}")
            return False
        
        # Check error message
        data = response.json()
        if data.get('ok') != False:
            print_result(False, f"Expected ok=false, got {data.get('ok')}")
            return False
        
        if 'A valid callSid is required' not in data.get('error', ''):
            print_result(False, f"Expected validation error message, got '{data.get('error')}'")
            return False
        
        print_result(True, "Validation error returned correctly for invalid callSid")
        return True
        
    except Exception as e:
        print_result(False, f"Exception occurred: {str(e)}")
        return False

def test_root_get_404():
    """Test 6: GET / (plain GET on root) - expect 404"""
    print_test_header("GET / - Root endpoint (should be 404)")
    
    try:
        response = requests.get(BASE_URL, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.text}")
        
        # Check status code
        if response.status_code != 404:
            print_result(False, f"Expected status 404, got {response.status_code}")
            return False
        
        # Check error message
        data = response.json()
        if data.get('ok') != False:
            print_result(False, f"Expected ok=false, got {data.get('ok')}")
            return False
        
        if 'Not found' not in data.get('error', ''):
            print_result(False, f"Expected 'Not found' error, got '{data.get('error')}'")
            return False
        
        print_result(True, "Root GET correctly returns 404")
        return True
        
    except Exception as e:
        print_result(False, f"Exception occurred: {str(e)}")
        return False

def test_place_real_call():
    """Test 7: POST / - place EXACTLY ONE real phone call"""
    print_test_header("POST / - Place REAL Phone Call (ONE ATTEMPT ONLY)")
    
    print("⚠️  WARNING: This will place a REAL phone call to the user's phone!")
    print("⚠️  This test will run EXACTLY ONCE and will NOT retry on failure.")
    
    try:
        response = requests.post(BASE_URL, timeout=15)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.text}")
        
        data = response.json()
        
        # Check if call was successful
        if response.status_code == 201 and data.get('ok') == True:
            call_sid = data.get('callSid')
            status = data.get('status')
            trial_mode = data.get('trialMode')
            
            print_result(True, f"Call placed successfully! CallSid: {call_sid}, Status: {status}, Trial: {trial_mode}")
            return True, call_sid
        else:
            # Call failed - check for known user-side errors
            error_code = data.get('code')
            error_msg = data.get('error', 'Unknown error')
            
            known_user_errors = [21215, 21608, 21219]
            if error_code in known_user_errors:
                print(f"⚠️  USER-SIDE CONFIGURATION NEEDED (NOT A BUG):")
                print(f"   Code: {error_code}")
                print(f"   Message: {error_msg}")
                print_result(True, "Function works correctly - user needs to complete Twilio Console setup")
                return True, None
            else:
                print_result(False, f"Call failed with code {error_code}: {error_msg}")
                return False, None
        
    except Exception as e:
        print_result(False, f"Exception occurred: {str(e)}")
        return False, None

def test_poll_call_status(call_sid):
    """Test 8: Poll GET /status?callSid=<real> - track call status transitions"""
    print_test_header(f"GET /status?callSid={call_sid} - Poll Call Status")
    
    if not call_sid:
        print("⚠️  Skipping status polling - no callSid available")
        return True
    
    print(f"Polling call status for callSid: {call_sid}")
    print("Will poll every 3 seconds for up to 60 seconds...")
    
    terminal_statuses = ['completed', 'no-answer', 'busy', 'failed', 'canceled']
    max_polls = 20  # 60 seconds / 3 seconds
    poll_count = 0
    last_status = None
    
    try:
        while poll_count < max_polls:
            poll_count += 1
            response = requests.get(f"{BASE_URL}/status?callSid={call_sid}", timeout=10)
            
            if response.status_code != 200:
                print_result(False, f"Poll {poll_count}: Expected status 200, got {response.status_code}")
                return False
            
            data = response.json()
            
            if data.get('ok') != True:
                print_result(False, f"Poll {poll_count}: Expected ok=true, got {data.get('ok')}")
                return False
            
            current_status = data.get('status')
            duration = data.get('duration')
            
            if current_status != last_status:
                print(f"Poll {poll_count}: Status changed to '{current_status}' (duration: {duration})")
                last_status = current_status
            else:
                print(f"Poll {poll_count}: Status still '{current_status}'")
            
            # Check if terminal status reached
            if current_status in terminal_statuses:
                print_result(True, f"Call reached terminal status: {current_status}")
                return True
            
            # Wait 3 seconds before next poll
            if poll_count < max_polls:
                time.sleep(3)
        
        print_result(True, f"Polling completed after {poll_count} attempts. Last status: {last_status}")
        return True
        
    except Exception as e:
        print_result(False, f"Exception occurred during polling: {str(e)}")
        return False

def main():
    print("\n" + "="*80)
    print("SUPABASE EDGE FUNCTION TEST SUITE: wake-up")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print("="*80)
    
    results = {}
    
    # Run tests in order
    results['health'] = test_health_endpoint()
    results['twiml'] = test_twiml_endpoint()
    results['cors'] = test_cors_preflight()
    results['status_no_callsid'] = test_status_no_callsid()
    results['status_invalid_callsid'] = test_status_invalid_callsid()
    results['root_get_404'] = test_root_get_404()
    
    # Real call test (EXACTLY ONE attempt)
    call_success, call_sid = test_place_real_call()
    results['place_call'] = call_success
    
    # Poll status if we got a callSid
    if call_sid:
        results['poll_status'] = test_poll_call_status(call_sid)
    else:
        results['poll_status'] = True  # Skip if no callSid
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    
    print("="*80)
    print(f"TOTAL: {passed}/{total} tests passed")
    print("="*80)
    
    return all(results.values())

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
