-- pstrainingres seed: ARDW Overview Workbook
-- Hand-translated from "ARDW Overview Workbook - Online.docx".
-- Run AFTER schema.sql. Idempotent: deletes any prior workbook with this title first.

do $$
declare
  v_trainer uuid;
  v_workbook uuid;
  v_sec uuid;
begin
  select id into v_trainer from profiles where role = 'trainer' order by created_at limit 1;
  if v_trainer is null then
    raise exception 'No trainer profile found. Bootstrap a trainer first.';
  end if;

  -- wipe any prior copy
  delete from workbooks where title = 'ARDW Overview Workbook';

  insert into workbooks (title, description, created_by)
  values ('ARDW Overview Workbook',
          'Amadeus Reservations Desktop Web — Overview (v2.0, revised 19 Jun 2023)',
          v_trainer)
  returning id into v_workbook;

  -- ====================================================================
  -- EXERCISE 1
  -- ====================================================================
  insert into sections (workbook_id, title, order_index)
  values (v_workbook, 'Exercise 1', 0) returning id into v_sec;

  insert into blocks (section_id, order_index, block_type, config) values
    (v_sec, 0, 'prose', $j${"html":"<p>Mr. Michael contacts you to make the following reservation.</p>"}$j$::jsonb),

    (v_sec, 1, 'table', $j${
      "caption":"Itinerary (Insert ARNK)",
      "headers":["Sector","Date","RBD","Airline"],
      "rows":[
        [{"kind":"static","text":"AUH - FRA"},{"kind":"input","id":"r0c1","input_type":"short_text"},{"kind":"static","text":"C"},{"kind":"static","text":"EY"}],
        [{"kind":"static","text":"PAR - AUH"},{"kind":"input","id":"r1c1","input_type":"short_text"},{"kind":"static","text":"M"},{"kind":"static","text":"EY"}]
      ]
    }$j$::jsonb),

    (v_sec, 2, 'prose', $j${"html":"<h3>Pricing</h3><p>Price as booked.</p>"}$j$::jsonb),
    (v_sec, 3, 'field', $j${"label":"Total Amount","input_type":"short_text"}$j$::jsonb),

    (v_sec, 4, 'prose', $j${"html":"<h3>Passenger details</h3>"}$j$::jsonb),
    (v_sec, 5, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Name"},{"kind":"static","text":"Mr. Michael Joseph"}]
      ]
    }$j$::jsonb),

    (v_sec, 6, 'prose', $j${"html":"<h4>Phones</h4>"}$j$::jsonb),
    (v_sec, 7, 'table', $j${
      "headers":["Name","Type","Country code","Number"],
      "rows":[
        [{"kind":"static","text":"Mr. Michael"},{"kind":"static","text":"Mobile"},{"kind":"static","text":"971"},{"kind":"static","text":"554567825"}],
        [{"kind":"static","text":"Mr. Michael"},{"kind":"static","text":"Home"},{"kind":"static","text":"49"},{"kind":"static","text":"692263656"}]
      ]
    }$j$::jsonb),

    (v_sec, 8, 'prose', $j${"html":"<h4>Email</h4><p>Mr. Michael Joseph — eytraining@yahoo.com</p>"}$j$::jsonb),

    (v_sec, 9, 'prose', $j${"html":"<h3>Ticketing</h3>"}$j$::jsonb),
    (v_sec, 10, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Card type"},{"kind":"static","text":"Visa"}],
        [{"kind":"static","text":"Card number"},{"kind":"static","text":"4000300020001000"}],
        [{"kind":"static","text":"Expiry"},{"kind":"static","text":"1028"}],
        [{"kind":"static","text":"CVV"},{"kind":"static","text":"420"}]
      ]
    }$j$::jsonb),

    (v_sec, 11, 'field', $j${"label":"Record Locator","input_type":"short_text"}$j$::jsonb),
    (v_sec, 12, 'field', $j${"label":"E-Ticket Number","input_type":"short_text"}$j$::jsonb);

  -- ====================================================================
  -- EXERCISE 2
  -- ====================================================================
  insert into sections (workbook_id, title, order_index)
  values (v_workbook, 'Exercise 2', 1) returning id into v_sec;

  insert into blocks (section_id, order_index, block_type, config) values
    (v_sec, 0, 'prose', $j${"html":"<p>Mr. Mansoor Alzarooni contacts you to make the following reservation.</p>"}$j$::jsonb),

    (v_sec, 1, 'table', $j${
      "caption":"Itinerary",
      "headers":["Sector","Date","RBD","Airline"],
      "rows":[
        [{"kind":"static","text":"AUH - LON"},{"kind":"input","id":"r0c1","input_type":"short_text"},{"kind":"static","text":"Q"},{"kind":"static","text":"EY"}],
        [{"kind":"static","text":"LON - AUH"},{"kind":"input","id":"r1c1","input_type":"short_text"},{"kind":"static","text":"Q"},{"kind":"static","text":"EY"}]
      ]
    }$j$::jsonb),

    (v_sec, 2, 'prose', $j${"html":"<h3>Pricing</h3><p>Price as booked.</p>"}$j$::jsonb),

    (v_sec, 3, 'prose', $j${"html":"<h3>Passenger details</h3><ul><li>Mr. Mansoor Alzarooni</li><li>Mrs. Huda Alzarooni</li><li>Mstr. Abdulaziz Alzarooni (DOB 13 Oct 2019)</li><li>Miss Amna Alzarooni (DOB 02 Jan 2025) — Associate with Mrs. Huda</li></ul>"}$j$::jsonb),

    (v_sec, 4, 'prose', $j${"html":"<h4>Phones</h4>"}$j$::jsonb),
    (v_sec, 5, 'table', $j${
      "headers":["Name","Type","Country","Number"],
      "rows":[
        [{"kind":"static","text":"Mr. Mansoor Alzarooni"},{"kind":"static","text":"Home"},{"kind":"static","text":"UAE"},{"kind":"static","text":"25626646"}],
        [{"kind":"static","text":"Mrs. Huda Alzarooni"},{"kind":"static","text":"Mobile"},{"kind":"static","text":"UK"},{"kind":"static","text":"7561445209"}]
      ]
    }$j$::jsonb),

    (v_sec, 6, 'prose', $j${"html":"<h4>Email</h4><p>Mr. Mansoor Alzarooni — eytraining@yahoo.com</p>"}$j$::jsonb),

    (v_sec, 7, 'prose', $j${"html":"<h3>Service Request</h3><h4>Meals (all flights)</h4>"}$j$::jsonb),
    (v_sec, 8, 'table', $j${
      "headers":["Passenger","Meal code"],
      "rows":[
        [{"kind":"static","text":"Mr. Mansoor"},{"kind":"static","text":"AVML"}],
        [{"kind":"static","text":"Mrs. Huda"},{"kind":"static","text":"FPML"}],
        [{"kind":"static","text":"Mstr. Abdulaziz"},{"kind":"static","text":"CHML"}],
        [{"kind":"static","text":"Miss Amna"},{"kind":"static","text":"BBML"}]
      ]
    }$j$::jsonb),

    (v_sec, 9, 'prose', $j${"html":"<h4>Wheelchairs (All Flights) — Ramp</h4>"}$j$::jsonb),
    (v_sec, 10, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Name"},{"kind":"static","text":"Mrs. Huda Alzarooni"}],
        [{"kind":"static","text":"Free text"},{"kind":"static","text":"NON-MEDA guest unable to walk long distance due to sprained leg"}],
        [{"kind":"static","text":"Remarks"},{"kind":"static","text":"GUEST ADVISED SPECIAL CATEGORY CONSENT REQUIREMENT AND ACCEPTED"}]
      ]
    }$j$::jsonb),

    (v_sec, 11, 'prose', $j${"html":"<h3>Passport Information</h3><h4>Mrs Huda Alzarooni</h4>"}$j$::jsonb),
    (v_sec, 12, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Passport No"},{"kind":"static","text":"76277800"}],
        [{"kind":"static","text":"Issue Country"},{"kind":"static","text":"Saudi Arabia"}],
        [{"kind":"static","text":"Gender"},{"kind":"static","text":"Female"}],
        [{"kind":"static","text":"DOB"},{"kind":"static","text":"02 Sep 1983"}],
        [{"kind":"static","text":"Exp Date"},{"kind":"static","text":"21 Nov 2025"}],
        [{"kind":"static","text":"Nationality"},{"kind":"static","text":"Saudi Arabia"}]
      ]
    }$j$::jsonb),

    (v_sec, 13, 'prose', $j${"html":"<h4>Miss Amna Alzarooni</h4>"}$j$::jsonb),
    (v_sec, 14, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Passport No"},{"kind":"static","text":"98388837"}],
        [{"kind":"static","text":"Issue Country"},{"kind":"static","text":"Saudi Arabia"}],
        [{"kind":"static","text":"Gender"},{"kind":"static","text":"Female"}],
        [{"kind":"static","text":"DOB"},{"kind":"static","text":"02 Jan 2025"}],
        [{"kind":"static","text":"Exp Date"},{"kind":"static","text":"31 Dec 2029"}],
        [{"kind":"static","text":"Nationality"},{"kind":"static","text":"Saudi Arabia"}]
      ]
    }$j$::jsonb),

    (v_sec, 15, 'prose', $j${"html":"<h3>Service Request / Price Services</h3><h4>Seats — Economy Seats (outbound only)</h4>"}$j$::jsonb),
    (v_sec, 16, 'field', $j${"label":"Seat numbers","input_type":"short_text"}$j$::jsonb),
    (v_sec, 17, 'field', $j${"label":"How much is the charge for the seats?","input_type":"short_text"}$j$::jsonb),

    (v_sec, 18, 'prose', $j${"html":"<h4>Prepaid Excess Baggage (Mr Mansoor only)</h4><p>AUH-LON — 5 Kgs</p>"}$j$::jsonb),
    (v_sec, 19, 'field', $j${"label":"Amount","input_type":"short_text"}$j$::jsonb),

    (v_sec, 20, 'prose', $j${"html":"<h3>Form of payment</h3><p>Issue tickets for all guest using below form of payment.</p>"}$j$::jsonb),
    (v_sec, 21, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Form of payment"},{"kind":"static","text":"Credit Card"}],
        [{"kind":"static","text":"Card type"},{"kind":"static","text":"Visa"}],
        [{"kind":"static","text":"Card number"},{"kind":"static","text":"4012000033330026"}],
        [{"kind":"static","text":"Expiry"},{"kind":"static","text":"1228"}],
        [{"kind":"static","text":"CVV"},{"kind":"static","text":"129"}]
      ]
    }$j$::jsonb),

    (v_sec, 22, 'table', $j${
      "headers":["Name","Ticket number"],
      "rows":[
        [{"kind":"static","text":"Mr. Mansoor Alzarooni"},{"kind":"input","id":"tkt_mansoor","input_type":"short_text"}],
        [{"kind":"static","text":"Mrs. Huda Alzarooni"},{"kind":"input","id":"tkt_huda","input_type":"short_text"}],
        [{"kind":"static","text":"Mstr. Abdulaziz Alzarooni"},{"kind":"input","id":"tkt_abdul","input_type":"short_text"}],
        [{"kind":"static","text":"Miss Amna Alzarooni"},{"kind":"input","id":"tkt_amna","input_type":"short_text"}]
      ]
    }$j$::jsonb),

    (v_sec, 23, 'field', $j${"label":"Record Locator","input_type":"short_text"}$j$::jsonb),

    (v_sec, 24, 'prose', $j${"html":"<h4>EMD Number</h4>"}$j$::jsonb),
    (v_sec, 25, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Standard Seat"},{"kind":"input","id":"emd_seat","input_type":"short_text"}],
        [{"kind":"static","text":"Excess baggage"},{"kind":"input","id":"emd_baggage","input_type":"short_text"}]
      ]
    }$j$::jsonb),

    (v_sec, 26, 'field', $j${"label":"Type of EMD","input_type":"check_group","options":["EMDS (Standalone)","EMDA (Associated)"]}$j$::jsonb);

  -- ====================================================================
  -- EXERCISE 3
  -- ====================================================================
  insert into sections (workbook_id, title, order_index)
  values (v_workbook, 'Exercise 3', 2) returning id into v_sec;

  insert into blocks (section_id, order_index, block_type, config) values
    (v_sec, 0, 'prose', $j${"html":"<p>Mr. Mansoor contacts you to make the following changes to his reservation.</p>"}$j$::jsonb),
    (v_sec, 1, 'field', $j${"label":"Original PNR from exercise 2","input_type":"short_text"}$j$::jsonb),

    (v_sec, 2, 'prose', $j${"html":"<h3>Divide</h3>"}$j$::jsonb),
    (v_sec, 3, 'table', $j${
      "headers":["Names","New PNR"],
      "rows":[
        [{"kind":"static","text":"Mr Mansoor Alzarooni"},{"kind":"input","id":"new_pnr","input_type":"short_text"}]
      ]
    }$j$::jsonb),

    (v_sec, 4, 'prose', $j${"html":"<p>Do the following changes on the new PNR.</p><h4>New Itinerary</h4>"}$j$::jsonb),
    (v_sec, 5, 'table', $j${
      "headers":["Sector","Date","RBD","Airline"],
      "rows":[
        [{"kind":"static","text":"AUH – LON"},{"kind":"input","id":"r0c1","input_type":"short_text"},{"kind":"static","text":"H"},{"kind":"static","text":"EY"}],
        [{"kind":"static","text":"LON – AUH"},{"kind":"static","text":"NO CHANGE"},{"kind":"static","text":""},{"kind":"static","text":""}]
      ]
    }$j$::jsonb),

    (v_sec, 6, 'prose', $j${"html":"<h4>Process exchange using below FOP</h4>"}$j$::jsonb),
    (v_sec, 7, 'table', $j${
      "rows":[
        [{"kind":"static","text":"Form of payment"},{"kind":"static","text":"Credit Card"}],
        [{"kind":"static","text":"Card type"},{"kind":"static","text":"Mastercard"}],
        [{"kind":"static","text":"Card number"},{"kind":"static","text":"5123450000000008"}],
        [{"kind":"static","text":"Expiry"},{"kind":"static","text":"1028"}],
        [{"kind":"static","text":"CVV"},{"kind":"static","text":"892"}]
      ]
    }$j$::jsonb);

  -- ====================================================================
  -- EXERCISE 4
  -- ====================================================================
  insert into sections (workbook_id, title, order_index)
  values (v_workbook, 'Exercise 4', 3) returning id into v_sec;

  insert into blocks (section_id, order_index, block_type, config) values
    (v_sec, 0, 'prose', $j${"html":"<p>Guest contacts you to refund his/her ticket.</p>"}$j$::jsonb),
    (v_sec, 1, 'field', $j${"label":"Original PNR from Ex 2","input_type":"short_text"}$j$::jsonb),
    (v_sec, 2, 'field', $j${"label":"Usage of the E-Ticket?","input_type":"choice","options":["FULLY UNUSED","PARTIALLY USED"]}$j$::jsonb),

    (v_sec, 3, 'prose', $j${"html":"<p>Divide below guest and process the refund.</p>"}$j$::jsonb),
    (v_sec, 4, 'table', $j${
      "headers":["Names","New PNR"],
      "rows":[
        [{"kind":"static","text":"Mstr. Abdulaziz Alzarooni"},{"kind":"input","id":"new_pnr","input_type":"short_text"}]
      ]
    }$j$::jsonb),

    (v_sec, 5, 'field', $j${"label":"Total refund Amount","input_type":"short_text"}$j$::jsonb),
    (v_sec, 6, 'field', $j${"label":"Trainee Notes","input_type":"long_text"}$j$::jsonb);

end $$;
