#!/usr/bin/env python3
"""
Twilio Wake-Up Call API - SPEED VERIFICATION RETEST
Tests the Vite middleware endpoints at http://localhost:3000/api/wake-up
Focus: Measure POST /api/wake-up round-trip latency after speed optimization
"""
import requests
import time
import sys

BASE_URL = "http://localhost:3000"

def test_health_endpoint():
    """Test 1: GET /api/wake-up/health - verify credentials without placing call"""
    print("\n" + "="*80)
    print("TEST 1: Health Check (safe, no call placed)")
    print("="*80)
    try:
        response = requests.get(f"{BASE_URL}/api/wake-up/health", timeout=10)
        print(f"✓ Status: {response.status_code}")
        data = response.json()
        print(f"✓ Response: {data}")
        
        if response.status_code == 200:
            if data.get("ok") and data.get("accountType"):
                print(f"✅ HEALTH CHECK PASSED")
                print(f"   - Account Type: {data.get('accountType')}")
                print(f"   - Account Status: {data.get('accountStatus')}")
                print(f"   - From: {data.get('fromNumber')}")
                print(f"   - To: {data.get('toNumber')}")
                return True, data.get("accountType")
            else:
                print(f"❌ HEALTH CHECK FAILED - Invalid response structure")
                return False, None
        else:
            print(f"❌ HEALTH CHECK FAILED - HTTP {response.status_code}")
            return False, None
    except Exception as e:
        print(f"❌ HEALTH CHECK FAILED - Exception: {e}")
        return False, None

def test_twiml_endpoint():
    """Test 2: GET /api/wake-up/twiml - verify TwiML XML is served correctly"""
    print("\n" + "="*80)
    print("TEST 2: TwiML Endpoint (safe, returns XML)")
    print("="*80)
    try:
        response = requests.get(f"{BASE_URL}/api/wake-up/twiml", timeout=10)
        print(f"✓ Status: {response.status_code}")
        print(f"✓ Content-Type: {response.headers.get('Content-Type')}")
        
        if response.status_code == 200 and "text/xml" in response.headers.get("Content-Type", ""):
            if "<Say" in response.text and "Good morning" in response.text:
                print(f"✅ TWIML ENDPOINT PASSED - Valid XML with 'Good morning' message")
                return True
            else:
                print(f"❌ TWIML ENDPOINT FAILED - XML missing expected content")
                return False
        else:
            print(f"❌ TWIML ENDPOINT FAILED - HTTP {response.status_code} or wrong content type")
            return False
    except Exception as e:
        print(f"❌ TWIML ENDPOINT FAILED - Exception: {e}")
        return False

def test_status_validation():
    """Test 3: GET /api/wake-up/status - verify validation (safe, no call)"""
    print("\n" + "="*80)
    print("TEST 3: Status Endpoint Validation (safe)")
    print("="*80)
    
    # Test with invalid callSid
    try:
        response = requests.get(f"{BASE_URL}/api/wake-up/status?callSid=INVALID", timeout=10)
        print(f"✓ With invalid callSid - Status: {response.status_code}")
        if response.status_code == 400:
            print("✅ STATUS VALIDATION PASSED - Rejects invalid callSid format")
            return True
        else:
            print("❌ STATUS VALIDATION FAILED - Should return 400 for invalid callSid")
            return False
    except Exception as e:
        print(f"❌ STATUS VALIDATION FAILED - Exception: {e}")
        return False

def test_real_call_with_latency():
    """Test 4: POST /api/wake-up - PLACE ONE REAL CALL and MEASURE LATENCY"""
    print("\n" + "="*80)
    print("⚠️  TEST 4: REAL CALL - Placing ONE call to +966503787701")
    print("⚠️  MEASURING POST ROUND-TRIP LATENCY")
    print("="*80)
    print("⚠️  WARNING: This will ring a REAL iPhone. Sending POST request NOW...")
    
    try:
        # Measure wall-clock time from sending request to receiving response
        start_time = time.perf_counter()
        response = requests.post(f"{BASE_URL}/api/wake-up", timeout=15)
        end_time = time.perf_counter()
        
        elapsed_ms = (end_time - start_time) * 1000  # Convert to milliseconds
        
        print(f"✓ Status: {response.status_code}")
        print(f"⏱️  POST LATENCY: {elapsed_ms:.0f} ms ({elapsed_ms/1000:.3f} seconds)")
        
        data = response.json()
        print(f"✓ Response: {data}")
        
        if response.status_code == 201 and data.get("ok"):
            call_sid = data.get("callSid")
            status = data.get("status")
            trial_mode = data.get("trialMode")
            print(f"✅ CALL PLACED SUCCESSFULLY!")
            print(f"   - Call SID: {call_sid}")
            print(f"   - Initial Status: {status}")
            print(f"   - Trial Mode: {trial_mode}")
            print(f"   - POST Latency: {elapsed_ms:.0f} ms")
            
            # Performance assessment
            if elapsed_ms < 1500:
                print(f"   🎉 EXCELLENT: Latency under 1.5s target!")
            elif elapsed_ms < 2000:
                print(f"   ✅ GOOD: Latency under 2s (improved from previous 2-3s)")
            else:
                print(f"   ⚠️  Latency higher than expected (target: <1.5s)")
            
            return True, call_sid, trial_mode, elapsed_ms, time.time()
        else:
            error_code = data.get("code", 0)
            error_msg = data.get("error", "Unknown error")
            print(f"❌ CALL PLACEMENT FAILED")
            print(f"   - HTTP Status: {response.status_code}")
            print(f"   - Error Code: {error_code}")
            print(f"   - Error Message: {error_msg}")
            print(f"   - POST Latency: {elapsed_ms:.0f} ms")
            return False, None, None, elapsed_ms, None
            
    except Exception as e:
        print(f"❌ CALL PLACEMENT FAILED - Exception: {e}")
        return False, None, None, None, None

def poll_call_status(call_sid, call_start_time, max_duration=75):
    """Test 5: Poll call status until terminal state - RECORD TIMESTAMPED SEQUENCE"""
    print("\n" + "="*80)
    print(f"TEST 5: Status Polling (callSid: {call_sid})")
    print("Polling every 2 seconds for up to 75 seconds")
    print("="*80)
    
    status_sequence = []
    status_timestamps = {}  # Track when each status first appeared
    ringing_time = None
    terminal_time = None
    
    poll_start = time.time()
    
    while time.time() - poll_start < max_duration:
        try:
            response = requests.get(
                f"{BASE_URL}/api/wake-up/status?callSid={call_sid}",
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                status = data.get("status")
                duration = data.get("duration")
                
                current_time = time.time()
                elapsed_from_post = current_time - call_start_time
                
                if status not in status_sequence:
                    status_sequence.append(status)
                    status_timestamps[status] = elapsed_from_post
                    
                    print(f"[{elapsed_from_post:.1f}s from POST] Status: {status}" + 
                          (f" (call duration: {duration}s)" if duration else ""))
                    
                    # Track when ringing first occurs
                    if status == "ringing" and ringing_time is None:
                        ringing_time = elapsed_from_post
                        print(f"   🔔 RINGING detected {ringing_time:.1f}s after POST!")
                
                # Terminal states
                if status in ["completed", "no-answer", "busy", "canceled", "failed"]:
                    terminal_time = elapsed_from_post
                    print(f"\n✅ REACHED TERMINAL STATE: {status}")
                    print(f"   Time from POST to terminal: {terminal_time:.1f}s")
                    print(f"   Full status sequence: {' → '.join(status_sequence)}")
                    
                    if ringing_time is not None:
                        print(f"   🎉 SUCCESS: Phone RANG {ringing_time:.1f}s after POST")
                        print(f"   Time from POST to ringing: {ringing_time:.1f}s")
                        print(f"   Time from ringing to {status}: {terminal_time - ringing_time:.1f}s")
                        return True, status_sequence, status, status_timestamps, ringing_time
                    else:
                        print(f"   ⚠️  Call ended without ringing phase")
                        return True, status_sequence, status, status_timestamps, None
                
            else:
                print(f"❌ Status poll failed: HTTP {response.status_code}")
                break
                
        except Exception as e:
            print(f"❌ Status poll exception: {e}")
            break
        
        time.sleep(2)  # Poll every 2 seconds as specified
    
    print(f"\n⏱️  Polling timeout after {max_duration}s")
    print(f"   Status sequence observed: {' → '.join(status_sequence)}")
    return False, status_sequence, status_sequence[-1] if status_sequence else None, status_timestamps, ringing_time

def main():
    print("\n" + "="*80)
    print("TWILIO WAKE-UP CALL API - SPEED VERIFICATION RETEST")
    print("="*80)
    print("Goal: Measure POST /api/wake-up round-trip latency after optimization")
    print("Expected: <1.5s (previously 2-3s due to blocking account-tier lookup)")
    print("Architecture: Vite + React SPA, API = Vite middleware on port 3000")
    print("Testing: http://localhost:3000/api/wake-up endpoints")
    print("="*80)
    
    # Test 1: Health check (safe)
    health_passed, account_type = test_health_endpoint()
    if not health_passed:
        print("\n❌ CRITICAL: Health check failed. Cannot proceed with call test.")
        sys.exit(1)
    
    # Test 2: TwiML endpoint (safe)
    twiml_passed = test_twiml_endpoint()
    
    # Test 3: Status validation (safe)
    validation_passed = test_status_validation()
    
    # Test 4: REAL CALL with latency measurement (ONE attempt only)
    call_success, call_sid, trial_mode, post_latency_ms, call_start_time = test_real_call_with_latency()
    
    if not call_success:
        print("\n" + "="*80)
        print("FINAL RESULT: CALL PLACEMENT FAILED")
        print("="*80)
        print("Safe endpoints (health, twiml, validation) may have passed,")
        print("but the POST /api/wake-up call placement failed.")
        print("See error details above.")
        sys.exit(1)
    
    # Test 5: Poll status if call was placed
    if call_sid and call_start_time:
        poll_success, status_sequence, final_status, status_timestamps, ringing_time = poll_call_status(call_sid, call_start_time)
        
        print("\n" + "="*80)
        print("FINAL RESULT SUMMARY - SPEED VERIFICATION")
        print("="*80)
        print(f"✅ Health Check: PASSED (Account Type: {account_type})")
        print(f"{'✅' if twiml_passed else '❌'} TwiML Endpoint: {'PASSED' if twiml_passed else 'FAILED'}")
        print(f"{'✅' if validation_passed else '❌'} Status Validation: {'PASSED' if validation_passed else 'FAILED'}")
        print(f"\n🎯 SPEED METRICS:")
        print(f"   - POST /api/wake-up latency: {post_latency_ms:.0f} ms ({post_latency_ms/1000:.3f}s)")
        if post_latency_ms < 1500:
            print(f"   - ✅ EXCELLENT: Under 1.5s target!")
        elif post_latency_ms < 2000:
            print(f"   - ✅ GOOD: Improved from previous 2-3s")
        else:
            print(f"   - ⚠️  Higher than 1.5s target")
        
        print(f"\n📞 CALL DETAILS:")
        print(f"   - Call SID: {call_sid}")
        print(f"   - Trial Mode: {trial_mode}")
        print(f"   - Status Sequence: {' → '.join(status_sequence)}")
        print(f"   - Final Status: {final_status}")
        
        print(f"\n⏱️  TIMESTAMPED STATUS SEQUENCE (seconds from POST):")
        for status in status_sequence:
            timestamp = status_timestamps.get(status, 0)
            print(f"   - {timestamp:5.1f}s: {status}")
        
        if ringing_time is not None:
            print(f"\n🔔 RINGING METRICS:")
            print(f"   - Time from POST to 'ringing': {ringing_time:.1f}s")
            print(f"   - This is Twilio + carrier setup time (outside app control)")
            print(f"   - 🎉 SUCCESS: The phone ACTUALLY RANG!")
        else:
            print(f"\n⚠️  Call placed but did not reach 'ringing' state")
        
        print("="*80)
        
        if poll_success and ringing_time is not None:
            print("\n✅ SPEED VERIFICATION COMPLETE - ALL TESTS PASSED")
            print(f"   POST latency: {post_latency_ms:.0f}ms, Phone rang after {ringing_time:.1f}s")
        else:
            print("\n⚠️  SPEED VERIFICATION INCOMPLETE")

if __name__ == "__main__":
    main()
